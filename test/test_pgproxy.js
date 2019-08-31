let {Client} = require('pg');
let assert = require('assert');

//replace cn information with your dev db
let client = new Client({
    host: '172.17.174.71',
    user: 'postgres',
    password: 'asdf1234',
    database: 'test'
});

let PGProxy = require('../lib');

describe('PGProxy Tests', () => {

    before(async () => {
        await client.connect();
        //await client.query('drop schema if exists test');
        //await client.query('create schema test');
    });

    it('should create new functions', async () => {
        let functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        let proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        let results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        let procs = results.rows;
        let found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_select_test');
        assert.notEqual(found, null);

        found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_system_name');
        assert.notEqual(found, null);
        PGProxy.destroy();

    });

    it('should execute and return correct values', async () => {
        let functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        let proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        let row = await proxy.select_test('asdf','1234');
        assert.equal(row.param1, 'asdf');
        assert.equal(row.param2, '1234');

        let name = await proxy.system_name("This is A TEST");
        assert.equal(name, 'this_is_a_test');
        PGProxy.destroy();
    });

    it('should update existing functions with changes', async () => {
        let functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2, 'changed' as param3`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        let proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        let results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        let procs = results.rows;
        let found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_select_test');
        assert.notEqual(found, null);

        found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_system_name');
        assert.notEqual(found, null);

        let row = await proxy.select_test('asdf','1234');
        assert.equal(row.param1, 'asdf');
        assert.equal(row.param2, '1234');
        PGProxy.destroy();

        functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select 'pass!' as param1, '${param2}' as param2, 'changed' as param3`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        row = await proxy.select_test('asdf','1234');
        assert.equal(row.param1, 'pass!');
        assert.equal(row.param2, '1234');
        PGProxy.destroy();


    });

    it('should fail to execute changed functions that are not updated', async () => {
        let functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        let proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        let results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        let procs = results.rows;
        let found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_select_test');
        assert.notEqual(found, null);

        found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_system_name');
        assert.notEqual(found, null);
        PGProxy.destroy();

        functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2, 'changed' as param3`);
                plv8.elog(NOTICE, "I wanna cookie");
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        proxy = await PGProxy.create(functions, {
            update_changed: false,
            client: client,
            schema: 'test'
        });

        try {
            let result = await proxy.select_test('nope', 'I said nope!');
            assert.ok(false); //should not reach here
        }
        catch(err) {
            assert.ok(true); 
        }

        let name = await proxy.system_name("This is A TEST");
        assert.equal(name, 'this_is_a_test');
        PGProxy.destroy();

    });

    it('should execute reverse proxy functions', async () => {
        let functions = {
            reverse_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
                nodeFunction(result);
                return result[0];
            }
        };
        let resolve;
        let promise = new Promise(
            (_resolve, reject) => {
                resolve = _resolve;
            }
        );
        let proxy = await PGProxy.create(functions, {
            client: client, 
            schema: 'test',
            expose: {
                nodeFunction: (result) => {
                    let row = result[0];
                    assert.equal(row.param1, 'asdf');
                    assert.equal(row.param2, '1234');
                    resolve();
                }
            }});
        let row = await proxy.reverse_test('asdf','1234');
        assert.equal(row.param1, 'asdf');
        assert.equal(row.param2, '1234');

        PGProxy.destroy();
        return promise;
    });



    it('should purge unwanted functions', async () => {
        let functions = {
            select_test: (param1, param2) => {
                let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2, 'changed' as param3`);
                return result[0];
            },
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        let proxy = await PGProxy.create(functions, {client: client, schema: 'test'});
        let results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        let procs = results.rows;
        let found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_select_test');
        assert.notEqual(found, null);

        found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_system_name');
        assert.notEqual(found, null);
        PGProxy.destroy();

        functions = {
            system_name: (name) => {
                return name
                    .toLowerCase()
                    .replace(/[^a-zA-Z ]/g, '')
                    .replace(/ /g, '_');
            }
        };
        proxy = await PGProxy.create(functions, {client: client, schema: 'test', purge_other: true});
        results = await client.query(`select proname, prosrc from pg_proc where proname like 'pgproxy_%'`);
        procs = results.rows;
        found = null;
        found = procs.find((proc) => proc.proname == 'pgproxy_select_test');
        assert.equal(found, null);

        try {
            let result = await proxy.select_test('nope', 'I said nope!');
            assert.ok(false); //should not reach here
        }
        catch(err) {
            assert.ok(true); 
        }
        PGProxy.destroy();
    });

    after(async () => {
        await client.end();
    })
});

/*
create or replace function test.pgproxy_reverse_test(params json)
returns json
language 'plv8'
as
$BODY$

function generateToken() {...}
function reverseProxy(name, args) {
	let payload = {fn:name, params: args, action: 'call'};
	plv8.execute(`NOTIFY pgproxy, '${JSON.stringify(payload)}'`);
}

function nodeFunction() { return reverseProxy.apply({},['nodeFunction',arguments]); }

let token = generateToken();
if(params.step == 0) {
	plv8.execute(`insert into pgproxy_state fn_name, step, token values 'pgproxy_reverse_test', 1, ${generateToken()},`)
}
	
let reverse_test = (param1, param2) => {
		if(params.step)
		let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
		nodeFunction(result);
		return result[0];
	};
let return_value = reverse_test.apply(plv8, params);
return JSON.stringify(return_value);
$BODY$*/