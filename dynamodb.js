
// yarn add aws-sdk

const AWS = require('aws-sdk')


AWS.config.getCredentials(function(err) {
    if (err) {
        console.log("Failed to load AWS creds/config", err);
    } else {
      console.log("AWS creds/config loaded", AWS.config.credentials.accessKeyId);
    }
});
AWS.config.update({region: 'us-east-1'})
const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'})


function sleep (ms) {
    return new Promise(r => setTimeout(r, ms))
}


// https://stackoverflow.com/questions/14810506/map-function-for-objects-instead-of-arrays
ddbItemMap = (o, fn) =>
    Object.fromEntries(
        Object.entries(o).map(
            ([k, v], i) => {
                if (k == 'title') {
                    k = 'name'
                }
                // order and position and index all reserved...
                if (k == 'sort') {
                    k = 'order'
                }
                return [k, fn(v, k, i)]
            }
        )
    )

function updateIdCacheItem (cache, itemDdb) {
    let item = ddbItemMap(itemDdb, (v, k, i) => v.S || parseInt(v.N));
    let idx = cache.findIndex(it => it.id == item.id)
    if (idx < 0) {
        cache.push(item)
    } else {
        cache[idx] = item
    }
}

async function createIdTable (name) {
    let params = {
        AttributeDefinitions: [
            {
                AttributeName: 'id',
                AttributeType: 'S'
            }
        ],
        KeySchema: [
            {
                AttributeName: 'id',
                KeyType: 'HASH'
            }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 1,
            WriteCapacityUnits: 1
        },
        TableName: name,
        StreamSpecification: {
            StreamEnabled: false
        }
    }

    try {
        let data = await ddb.createTable(params).promise()
        console.log(`Id Table '${name}' Created`, data)
    } catch (err) {
        console.log(`Id Table '${name}' Create Error`, err)
    }
}

async function createIdTableIfNeeded (name, count = 0) {
    if (count > 5) {
        throw new Exception(`Table ${name} failed to Create!`)
    }

    let params = {
        TableName: name,
    }

    try {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#describeTable-property
        let data = await ddb.describeTable(params).promise()
        console.log(`Id Table '${name}' Describe`, data)

        status = data.Table.TableStatus
    } catch (err) {
        console.log(`Id Table '${name}' Describe Error`, err)
        status = null
    }

    // wait until status is ACTIVE, instead of CREATING
    if (status == "CREATING") {
        // https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
        await sleep(3000)
        await createIdTableIfNeeded(name, count + 1)
    }

    else if (!status) {
        await createIdTable(name)
        await sleep(5000)
        await createIdTableIfNeeded(name, count + 1)
    }
}

async function populateStateCache (tableName, cache, fields) {
    await createIdTableIfNeeded(tableName)

    let projection = fields.join(', ')
    // https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/dynamodb-example-query-scan.html#dynamodb-example-table-query-scan-scanning
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#scan-property
    let params = {
        ProjectionExpression: projection,
        TableName: tableName
    }
    console.log(`Scanning '${tableName}' for '${projection}'`);

    try {
        let data = await ddb.scan(params).promise()
        console.log(`Scan '${tableName}' Success`);//, data

        cache.length = 0
        data.Items.forEach(function(itemDdb, i, a) {
            updateIdCacheItem(cache, itemDdb)
        })
    } catch (err) {
        console.log(`Scan '${tableName}' Error`, err);
    }
}

/*
async function createTablesIfNeeded (tableNames) {
    // verify all tables are present, create if not, verify categories are present, create if not
    try {
        let data = await ddb.listTables({Limit: 100}).promise()
        console.log("List tables Success")//, data

        let tablesToAdd =
            tableNames.filter(name => !data.TableNames.includes(name))
        console.log("Tables to add", tablesToAdd)
        for (let name of tablesToAdd) {
            await createIdTable(name)
        }
    } catch (err) {
        console.log("List tables Error", err)
    }
}
*/

// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/dynamodb-example-table-read-write.html
async function upsertIdRow (tableName, cache, fieldValues) {
    const params = {
        TableName: tableName,
        Item: fieldValues
    }

    try {
        let data = await ddb.putItem(params).promise()
        console.log(`Upsert '${tableName}' Success`, data)
        updateIdCacheItem(cache, params.Item)
    } catch (err) {
        console.log(`Upsert '${tableName}' Error`, err)
        return {obj: err}
    }
}

async function deleteIdRow (tableName, cache, id) {
    if (!cache.find(item => item.id == id)) {
        return `No such id found for '${tableName}'`
    }

    const params = {
        TableName: tableName,
        Key: {
            'id': {S: id}
        }
    }

    try {
        let data = await ddb.deleteItem(params).promise()
        console.log(`Delete '${tableName}' Success`, data)
        let idx = cache.findIndex(item => item.id == id)
        if (idx < 0) {
            console.log(`Delete '${tableName}' Error: could not find idx after delete!`)
        } else {
            cache.splice(idx, 1)
        }
    } catch (err) {
        console.log(`Delete '${tableName}' Error`, err)
        return {obj: err}
    }
}

module.exports = {
    populateStateCache,
    upsertIdRow,
    deleteIdRow,
}
