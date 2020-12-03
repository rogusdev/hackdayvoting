
// yarn add pg

const { Pool } = require('pg')

const pool = new Pool({
    user: 'postgres',
    password: 'badpassword',
    host: 'postgres-www',
})

// the pool will emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})


function sleep (ms) {
    return new Promise(r => setTimeout(r, ms))
}


function updateIdCacheItem (cache, item) {
    let idx = cache.findIndex(it => it.id == item.id)
    if (idx < 0) {
        cache.push(item)
    } else {
        cache[idx] = item
    }
}

async function createIdTable (name) {
}

async function createIdTableIfNeeded (name, count = 0) {
    if (count > 5) {
        throw new Exception(`Table ${name} failed to Create!`)
    }
}

async function populateStateCache (tableName, cache, fields) {
    await createIdTableIfNeeded(tableName)
}

async function upsertIdRow (tableName, cache, fieldValues) {
}

async function deleteIdRow (tableName, cache, id) {
    if (!cache.find(item => item.id == id)) {
        return `No such id found for '${tableName}'`
    }
}

module.exports = {
    populateStateCache,
    upsertIdRow,
    deleteIdRow,
}
