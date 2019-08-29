let crypto = require('crypto');
let pg = require('pg');

/**
 * PGProxy is a class used to execute local nodejs function on a postgres server using plv8
 */
class PGProxy {

    /**
     * Normalize the text to remove whitespace. This is part of the change detection algorithm.
     * @param {*} text 
     */
    static _normalize(text) {
        return text.replace(/\s/g,'');
    }

    /**
     * Create a fast hash of text in order to detect changes
     * @param {*} text 
     */
    static _hash(text) {
        let hash = crypto.createHash('sha1');
        return hash.update(text).digest('base64');
    }

    /**
     * Create a postgres plv8 function with the passed in source
     * @param {*} source 
     * @param {*} name 
     * @param {*} schema
     */
    static _createPgFunctionSource(source, name, schema) {
        schema= schema || 'public';
        return `
        create or replace function ${schema}.pgproxy_${name}(params json)
        returns json
        language 'plv8'
        as
        $BODY$
        let ${name} = ${source};
        let return_value = ${name}.apply(plv8, params);
        return JSON.stringify(return_value);
        $BODY$
        `;
    }

    /**
     * Given an array of function objects '{name, source}' detect:
     * 1. New functions to add
     * 2. Changed functions
     * 3. Other functions - i.e. functions that are pgproxy function but not included in the given object. 
     * Can be used for purge, if needed
     * @param {*} functions 
     */
    static async _detectChanges(functions, client) {
        let new_functions = [];
        let changed_functions = [];
        let unchanged_functions = [];
        let other_functions = [];
        let results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        let rows = results.rows;
        for(let fn of functions) {
            let row = rows.find((row) => `pgproxy_${fn.name}` == row.proname);
            //detect new functions
            if(!row) {
                new_functions.push(fn);
                continue;
            }

            let procedure_source = row.prosrc;
            let function_source = fn.source;
            let start_index = function_source.indexOf('$BODY$');
            start_index += '$BODY$'.length; 
            let end_index = function_source.indexOf('$BODY$',start_index);
            function_source = function_source.substring(start_index, end_index);

            //detect changed functions
            let function_hash = this._hash(this._normalize(function_source));
            let procedure_hash = this._hash(this._normalize(procedure_source));
            if(function_hash == procedure_hash) {
                unchanged_functions.push(fn);
                continue;
            }
            else {
                changed_functions.push(fn);
                continue;
            }

        }
        other_functions = rows.filter(
            (row) => 
                !functions.find( (fn) => 
                    row.proname == `pgproxy_${fn.name}`
            )
        );
        other_functions = other_functions.map(
            fn => 
                {return {name: fn.proname.replace('pgproxy_','')}}
        );
        return { new_functions, changed_functions, unchanged_functions, other_functions };
    }

    /**
     * Synchronize the db and keep track of all functions that exist in the list of requested functions
     * and the functions that are in the db.
     * 
     * We track functions that have changed but aren't updated in the db and explicity refuse to execute them,
     * same with new functions that don't exist in the db.
     * @param {*} changes 
     * @param {*} options 
     * @param {*} client 
     */
    static async _syncDb(changes, options, client) {
        let enabled_functions = [...changes.unchanged_functions];
        let disabled_functions = [];

        if(changes.new_functions.length) {
            if(options.create_new) {
                for (let fn of changes.new_functions) {
                    await client.query(fn.source);
                    enabled_functions.push(fn);
                }
            }
            //we can't execute a function that doesn't exist on the server!
            else {
                disabled_functions = disabled_functions.concat(changes.new_functions);
            }
        }

        if(changes.changed_functions.length) {
            if(options.update_changed) {
                for(let fn of changes.changed_functions) {
                    await client.query(fn.source);
                    enabled_functions.push(fn);
                }
            }
            else {
                //if functions have changed, but we're not set to update them in the db,
                //they need to be disabled for safety. This prevents execution of a function
                //where the source has changed, which could cause unintended effects
                disabled_functions = disabled_functions.concat(changes.changed_functions);
            }
        }

        //purge any pgproxy functions in the db that aren't in our object
        if(changes.other_functions.length) {
            if(options.purge_other) {
                for(let fn of changes.other_functions) {
                    await client.query(`drop function ${options.schema}.pgproxy_${fn.name}`);
                }
            }
        }
        return {enabled_functions, disabled_functions}
    }

    /**
     * Create a proxy object used to execute the plv8 function on the server
     * @param {*} changes 
     * @param {*} options 
     * @param {*} client 
     */
    static async _createProxy(enabled_functions, disabled_functions, options, client) {

        let proxy = {};

        let exec = (name) => {
                return async function() {
                    let result = await client.query(`select ${options.schema}.pgproxy_${name}($1::json)`,[JSON.stringify([...arguments])]);
                    if(!result.rows)
                        return null;
                    if(!result.rows.length)
                        return null;
                    let row = result.rows[0];
                    let returned = row['pgproxy_' + name];
                    return returned;
                }
        };

        let disabled = (name) => {
            return function() {
                throw new Error("The function with name: " + name + " has been disabled because it is out of sync with the database");
            }
        }

        for(let fn of enabled_functions) {
            proxy[fn.name] = exec(fn.name);
        }

        for(let fn of disabled_functions) {
            proxy[fn.name] = disabled(fn.name);
        }

        return proxy;
    }

    /**
     * Returns a proxy that can be used to execute functions on a postgres server.
     * For a passed in object, each function will be created as a plv8 function on the remote server.
     * The returned proxy can be used to execute each function. All methods will return a promise that 
     * resolves with the results on the server.
     * @param {*} object The object to create a proxy for
     * @param {*} options Options to use during creation
     */
    static async create(obj, options) {
        let keys = Object.keys(obj);
        let functions = [];
        options = Object.assign({
            schema: 'public',
            client: null,
            create_new: true,
            update_changed: true,
            purge_other: false
        },options);

        let client = options.client;
        //first, let's ensure a connection
        if(client) {
            //await client.connect();
        }
        else {
            throw new Error('Must provide a valid pg client');
        }

        //create function info
        keys.forEach(
            (key) => {
                let fn = obj[key];
                if((typeof fn) !== 'function')
                    return;

                let pg_source = this._createPgFunctionSource(fn, key, options.schema)
                functions.push({
                    name: key,
                    source: pg_source
                });
            }
        );

        let changes = await this._detectChanges(functions, client);
        let sync_result = await this._syncDb(changes, options, client);
        let proxy = await this._createProxy(sync_result.enabled_functions, sync_result.disabled_functions, options, client);
        return proxy;
    }
}

module.exports = PGProxy;