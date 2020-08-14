/*

yarn init -y
yarn add express google-auth-library aws-sdk
yarn start  # actually runs node server.js

# https://stackoverflow.com/questions/7172784/how-do-i-post-json-data-with-curl
curl -H "Content-Type: application/json" -X POST \
  --data '{"id_token":"xyz"}' \
  http://localhost:3000/authtest

*/

const express = require('express')
//const cookieParser = require('cookie-parser')
const app = express()
const PORT = process.env.PORT || 3000

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

const { OAuth2Client } = require('google-auth-library')
const CLIENT_ID = "861609598303-o00osplh8n4jidur6mr6931c8sjikjuu.apps.googleusercontent.com"
const googleOAuth2Client = new OAuth2Client(CLIENT_ID)

const uuidv4 = require('uuid')

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN
const DUMP_AUTH = process.env.DUMP_AUTH


// TODO: (ha not likely) i18n
const RESP_CODE_INVALID_TOKEN = 1
const RESP_MSG_INVALID_TOKEN = 'Invalid token'
const RESP_CODE_INVALID_CATEGORY_ID = 2
const RESP_MSG_INVALID_CATEGORY_ID = 'Invalid category id'
const RESP_CODE_INVALID_PROJECT_ID = 3
const RESP_MSG_INVALID_PROJECT_ID = 'Invalid project id'
const RESP_CODE_INVALID_VOTE_ID = 4
const RESP_MSG_INVALID_VOTE_ID = 'Invalid vote id'
const RESP_CODE_DUPLICATE_VOTE = 5
const RESP_MSG_DUPLICATE_VOTE = 'Duplicate vote'
const RESP_CODE_INVALID_DOMAIN = 6
const RESP_MSG_INVALID_DOMAIN = 'Invalid email domain'
const RESP_CODE_NOT_OWNER = 7
const RESP_MSG_NOT_OWNER = 'You are not the owner!'
const RESP_CODE_INVALID_DATA = 8
const RESP_MSG_INVALID_DATA = 'Invalid data'


const TABLE_NAME_CATEGORIES = 'HackDay.Categories'
const TABLE_NAME_PROJECTS = 'HackDay.Projects'
const TABLE_NAME_VOTES = 'HackDay.Votes'



// kind of important... -- could be a class to encapsulate all this in the future
let state = {
    categories: [],
    projects: [],
    votes: [],
}

function sendStateData (res) {
    console.log("Sending state data")
    res.send({ data: state })
}

function sendErr (res, err) {
    console.log("Sending err", err)
    res.send({err: err})
}

function stateDataOnSuccess (res, err) {
    if (err) {
        sendErr(res, err)
    } else {
        sendStateData(res)
    }
}


async function googleTokenVerify (res, idToken) {
    try {
        const ticket = await googleOAuth2Client.verifyIdToken({
            idToken: idToken,
            audience: [CLIENT_ID]
        })
        const payload = ticket.getPayload()

        if (ALLOWED_DOMAIN && (!payload['hd'] || payload['hd'] != ALLOWED_DOMAIN)) {
            return {code: RESP_CODE_INVALID_DOMAIN, msg: RESP_MSG_INVALID_DOMAIN}
        }

        // https://stackoverflow.com/questions/18875292/passing-variables-to-the-next-middleware-using-next-in-express-js
        res.locals.userid = payload['sub']
        res.locals.email = payload['email']
    } catch (err) {
        return {code: RESP_CODE_INVALID_TOKEN, msg: RESP_MSG_INVALID_TOKEN}
    }
}


// https://stackoverflow.com/questions/14810506/map-function-for-objects-instead-of-arrays
ddbItemMap = (o, fn) =>
    Object.fromEntries(
        Object.entries(o).map(
            ([k, v], i) => {
                if (k == 'title') {
                    k = 'name'
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

async function populateStateCache (tableName, cache, projection) {
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

        data.Items.forEach(function(itemDdb, i, a) {
            updateIdCacheItem(cache, itemDdb)
        })
    } catch (err) {
        console.log(`Scan '${tableName}' Error`, err);
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

        // TODO: wait until status is ACTIVE, instead of CREATING
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#describeTable-property
    } catch (err) {
        console.log(`Id Table '${name}' Create Error`, err)
    }
}

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

async function upsertProject (name, description, members, slogan, authorEmail, createdAt = null, id = null) {
    if (id && state.projects.some(p => p.authorEmail != authorEmail && p.id == id)) {
        return {code: RESP_CODE_NOT_OWNER, msg: RESP_MSG_NOT_OWNER}
    }
    if (!name) {
        return {code: RESP_CODE_INVALID_DATA, msg: RESP_MSG_INVALID_DATA}
    }

    return await upsertIdRow(
        TABLE_NAME_PROJECTS,
        state.projects,
        {
            'title' : {S: name},
            'description' : {S: description},
            'members' : {S: members},
            'slogan' : {S: slogan},
            'authorEmail': {S: authorEmail},
            'createdAt': {N: createdAt || ('' + Date.now())},
            'id' : {S: id || uuidv4()}
        }
    )
}

async function upsertVote (projectId, categoryId, authorEmail, id = null) {
    if (!state.projects.find(project => project.id == projectId)) {
        return {code: RESP_CODE_INVALID_PROJECT_ID, msg: RESP_MSG_INVALID_PROJECT_ID}
    }
    if (!state.categories.find(category => category.id == categoryId)) {
        return {code: RESP_CODE_INVALID_CATEGORY_ID, msg: RESP_MSG_INVALID_CATEGORY_ID}
    }
    if (state.votes.some(
        v => v.projectId == projectId && v.categoryId == categoryId && v.authorEmail == authorEmail && v.id != id
    )) {
        return {code: RESP_CODE_DUPLICATE_VOTE, msg: RESP_MSG_DUPLICATE_VOTE}
    }
    if (id && state.votes.some(v => v.authorEmail != authorEmail && v.id == id)) {
        return {code: RESP_CODE_NOT_OWNER, msg: RESP_MSG_NOT_OWNER}
    }

    return await upsertIdRow(
        TABLE_NAME_VOTES,
        state.votes,
        {
            'projectId' : {S: projectId},
            'categoryId' : {S: categoryId},
            'authorEmail': {S: authorEmail},
            'id' : {S: id || uuidv4()}
        }
    )
}


// https://expressjs.com/en/starter/static-files.html
app.use(express.static('public'))

// https://expressjs.com/en/resources/middleware/cookie-parser.html
//app.user(cookieParser())

// https://stackoverflow.com/questions/10005939/how-do-i-consume-the-json-post-data-in-an-express-application
app.use(express.json())

// https://medium.com/dailyjs/rewriting-javascript-converting-an-array-of-objects-to-an-object-ec579cafbfc7
const dictByIdOfArray = (arr) =>
    arr.reduce((obj, item) => {
        obj[item.id] = item
        return obj
    }, {})

app.get('/votes/dump', async (req, res, next) => {
    if (req.headers.authorization != DUMP_AUTH) {
        console.log('Invalid auth token for data dump')
        res.send('')
        return
    }

    console.log('Votes dump')
    let voteCounts = {}
    let projectIdToDetails = dictByIdOfArray(state.projects)
    let categoryIdToDetails = dictByIdOfArray(state.categories)

    for (let vote of state.votes) {
        let project = projectIdToDetails[vote.projectId]
        let category = categoryIdToDetails[vote.categoryId]
        if (!project) {
            console.log(`Missing project '${projectId}' for vote '${vote.id}'!`)
            continue
        }
        if (!category) {
            console.log(`Missing category '${categoryId}' for vote '${vote.id}'!`)
            continue
        }

        let countId = project.id + "+" + category.id
        let oldCount = voteCounts.hasOwnProperty(countId) ? voteCounts[countId].count : 0
        voteCounts[countId] = {
            count: oldCount + 1,
            project: project,
            category: category
        }
    }

    let data = []

    voteCounts = Object.values(voteCounts)
    voteCounts.sort((a, b) => {
        if (a.category.name != b.category.name) {
            return a.category.name > b.category.name ? 1 : -1
        }
        // sort desc == reversed
        return b.count - a.count
    })

    for (let countId in voteCounts) {
        let count = voteCounts[countId].count
        let project = voteCounts[countId].project
        let category = voteCounts[countId].category

        data.push([
            category.name,
            count,
            project.name,
            project.description,
            project.members,
            project.slogan
        ].join("\t") + "\n")
    }

    res.send(data.join(''))
})

app.get('/projects/dump', async (req, res, next) => {
    if (req.headers.authorization != DUMP_AUTH) {
        console.log('Invalid auth token for data dump')
        res.send('')
        return
    }

    console.log('Projects dump')
    const HEADER = ['Winner	Timestamp	Title	Description	Members	Slogan	Author\n']
    const projectRows = state.projects.map(
        project => [
            '__',
            '0:00:00',
            //project.id,
            project.name,
            project.description,
            project.members,
            project.slogan,
            project.authorEmail,
            //project.createdAt,
        ].join("\t") + "\n"
    )
    res.send(HEADER.concat(projectRows).join(''))
})

app.use(async (req, res, next) => {
    console.log('Time: %d', Date.now())
    if (!req.body || !req.body.id_token) {
        console.log(`Missing token in request`)
        sendErr(res, {code: RESP_CODE_INVALID_TOKEN, msg: RESP_MSG_INVALID_TOKEN})
        return
    }
    let err = await googleTokenVerify(res, req.body.id_token)
    if (err) {
        console.log(`Error in request token`, err)
        sendErr(res, err)
        return
    }
    delete req.body.id_token  // clear for safety, now that we used it
    console.log(res.locals.userid)
    console.log(res.locals.email)
    next()
})

app.post('/authtest', async (req, res, next) => {
    console.log('cookies')
    console.log(req.cookies)
    console.log('body')
    console.log(req.body)
    res.send({ data: { a: 1, b: true, z: "yo", 123: 4.56, c: null }})
})

app.post('/state', async (req, res, next) => {
    console.log('Get state')
    state.count++
    sendStateData(res)
})

app.post('/projects', async (req, res, next) => {
    console.log('Upsert project')
    let err = await upsertProject(
        req.body.name,
        req.body.description,
        req.body.members,
        req.body.slogan,
        res.locals.email,
        req.body.createdAt,
        req.body.id
    )
    sortStateProjects()
    stateDataOnSuccess(res, err)
})

app.post('/votes', async (req, res, next) => {
    console.log('Upsert vote')
    let err = await upsertVote(
        req.body.projectId,
        req.body.categoryId,
        res.locals.email,
        req.body.id
    )
    stateDataOnSuccess(res, err)
})

app.delete('/projects', async (req, res, next) => {
    console.log('Delete project')
    let err = await deleteIdRow(
        TABLE_NAME_PROJECTS,
        state.projects,
        req.body.id
    )
    // clear all orphaned votes (e.g. for this now deleted project)
    let projectIds = state.projects.map(project => project.id)
    let categoryIds = state.categories.map(category => category.id)
    for (let vote of state.votes) {
        if (!projectIds.includes(vote.projectId) || !categoryIds.includes(vote.categoryId)) {
            await deleteIdRow(
                TABLE_NAME_VOTES,
                state.votes,
                vote.id
            )
        }
    }
    stateDataOnSuccess(res, err)
})

app.delete('/votes', async (req, res, next) => {
    console.log('Delete vote')
    let err = await deleteIdRow(
        TABLE_NAME_VOTES,
        state.votes,
        req.body.id
    )
    stateDataOnSuccess(res, err)
})

async function populateHackDayCategories () {
    const hackDayCategories = [
        'Company',
        'Personal',
        'Slogan',
    ]

    const categoryNames = state.categories.map(v => v.name);
    let categoriesToAdd =
        hackDayCategories.filter(name => !categoryNames.includes(name));
    console.log("Categories to add", categoriesToAdd)
    for (let name of categoriesToAdd) {
        await upsertIdRow(
            TABLE_NAME_CATEGORIES,
            state.categories,
            {
                'title' : {S: name},
                'id' : {S: uuidv4()}
            }
        )
    }
}

// function sortStateProjects () {
//     state.projects.sort((a, b) => {
//         if ((a.createdAt && !b.createdAt) || a.createdAt > b.createdAt) return 1
//         if ((!a.createdAt && b.createdAt) || a.createdAt < b.createdAt) return -1
//         if (a.id > b.id) return 1
//         if (a.id < b.id) return -1
//         return 0
//     })
// }

function sortStateProjects () {
    state.projects.sort((a, b) => {
        if (a.createdAt > b.createdAt) return 1
        if (a.createdAt < b.createdAt) return -1
        if (a.id > b.id) return 1
        if (a.id < b.id) return -1
        return 0
    })
}

// function sortStateProjects () {
//     state.projects.sort((a, b) => {
//         console.log(a.createdAt && !b.createdAt)
//         console.log(!a.createdAt && b.createdAt)

//         if ((a.createdAt && !b.createdAt) || a.createdAt > b.createdAt) {
//             console.log("a created > b")
//             return 1
//         }
//         if ((!a.createdAt && b.createdAt) || a.createdAt < b.createdAt) {
//             console.log("a created < b")
//             return -1
//         }
//         if (a.id > b.id) {
//             console.log("a id > b", a.createdAt, b.createdAt)
//             return 1
//         }
//         if (a.id < b.id) {
//             console.log("a id < b", a.createdAt, b.createdAt)
//             return -1
//         }
//         console.log("a == b")
//         return 0
//     })
// }


async function init () {
    console.log(`Initializing Hack Day Voting Server...`)

    await createTablesIfNeeded([
        TABLE_NAME_CATEGORIES,
        TABLE_NAME_PROJECTS,
        TABLE_NAME_VOTES,
    ])
    console.log(`Tables available!`)

    await populateStateCache(
        TABLE_NAME_CATEGORIES,
        state.categories,
        'title, id'
    )
    await populateHackDayCategories()
    console.log("Hack Day Categories populated");//, state.categories

    await populateStateCache(
        TABLE_NAME_PROJECTS,
        state.projects,
        'title, description, members, slogan, authorEmail, createdAt, id'
    )

    // for (let i in state.projects) {
    //     let t = 1597247700 - i
    //     let p = state.projects[i]
    //     let err = await upsertProject(
    //         p.name,
    //         p.description,
    //         p.members,
    //         p.slogan,
    //         p.authorEmail,
    //         ('' + p.createdAt) || '' + t + '000',
    //         p.id
    //     )
    //     console.log(`updating`, p)
    // }

    sortStateProjects()
    await populateStateCache(
        TABLE_NAME_VOTES,
        state.votes,
        'projectId, categoryId, authorEmail, id'
    )
    console.log(`Caches populated!`)//, state
    //console.log(`projects`, state.projects)
}

init().then((err) => {
    if (err) {
        console.log("Error in init", err)
    } else {
        app.listen(PORT, () => console.log(`Listening on port ${PORT}!`))
    }
})


// state.projects = [
//     {
//         authorEmail: 'raghav.narain@braze.com',
//         description: 'See the status of your braze exports',
//         id: '389afef0-5f7b-4c1f-bd8f-8e29e9eff371',
//         slogan: 'Why is my export taking so long?',
//         members: 'Raghav Narain',
//         name: 'Braze Exports Dashboard'
//     },
//     {
//         authorEmail: 'chris.rogus@braze.com',
//         slogan: 'test 01',
//         members: 'rogus',
//         createdAt: 1597247700909,
//         description: 'test 01',
//         id: '444de997-989a-46e9-b201-f294228b0fdc',
//         name: 'test 01'
//     },
//     {
//         authorEmail: 'michael.dulle@braze.com',
//         description: 'Super simple translation layer for creating a demoable, localized Dashboard',
//         id: 'f2e03d3a-1af5-4986-be00-6b97803d3a71',
//         slogan: 'let translation = awesome',
//         members: 'Mike Dulle',
//         name: 'Localization!'
//     },
// ]
// sortStateProjects()
// console.log(`projects`, state.projects)
