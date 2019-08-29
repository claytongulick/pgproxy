# pgproxy
Execute plv8 functions from node. Execute node functions from plv8.

## Installation
```npm install pgproxy```

## Usage
Give PGProxy an object with a set of functions, and it will synchronize the database, create, update or optionally delete unwanted plv8 functions. It returns an object that can be used from node to execute the plv8 functions on the server.

### Example:
```javascript

let {Client} = require('pg');
let assert = require('assert');

//replace cn information with your dev db
let client = new Client({
    host: 'somewhere',
    user: 'someone',
    password: 'something',
    database: 'test'
});

let PGProxy = require('pgproxy');

let functions = {
    select_test: (param1, param2) => {
        //this all executes on postgres server!
        let result = plv8.execute(`select '${param1}' as param1, '${param2}' as param2`);
        someNodeFunction(result); //this executes back in node!
        return result[0];
    },
    system_name: (name) => {
        return name
            .toLowerCase()
            .replace(/[^a-zA-Z ]/g, '')
            .replace(/ /g, '_');
    }
};
let proxy = await PGProxy.create(functions, {
    client: client, 
    schema: 'test',
    expose: {
        someNodeFunction: (result) => {
            console.log(result);
        }
    }});
let row = await proxy.select_test('asdf','1234');
assert.equal(row.param1, 'asdf');
assert.equal(row.param2, '1234');

let name = await proxy.system_name("This is A TEST");
assert.equal(name, 'this_is_a_test');
```

## Options
PGProxy accepts this following object with options when creating the proxy:
```javascript

        {
            schema: 'public', //the schema to create the proxy functions in
            client: null, //required: an open and available node-pg client
            create_new: true, //should new functions be created on the server?
            update_changed: true, //should changed functions be updated?
            purge_other: false, //should old pgproxy_functions be dropped?
            expose: { 
                someFunction: () => {...}, 
                anotherFunction: () => {...}
            } //functions that will be callable from inside plv8
        }

```

## How it works
PGProxy is a simple utility that will take some functions and wrap them in a plv8 function template. It serializes parameters and passes them into the created db stored procedure.

Each function needs to be standalone - i.e. closures etc... won't work, since we're just doing a toSource() on the function and creating a plv8 version on the server.

Any values returned from the server are serialized to json, and parsed back into values on the node side.

You can expose functions on the node side to the plv8 function as well, however you can't return a value back. This is because the mechanism to execute the node function is simple message passing using pg's NOTIFY capability. Unfortunately, there's no way to respond to a NOTIFY message currently, so the reverse proxy is a "fire and forget" type thing, there's no error handling or response passing. Still, it could be useful in certain situations like logging.

## Development status
Early!

All tests are passing, but it's still early in development. That being said, this utility is being used in production systems currently.
