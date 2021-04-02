/*

yarn init -y
yarn add express google-auth-library
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


const { OAuth2Client } = require('google-auth-library')
const CLIENT_ID = "861609598303-o00osplh8n4jidur6mr6931c8sjikjuu.apps.googleusercontent.com"
const googleOAuth2Client = new OAuth2Client(CLIENT_ID)

const uuidv4 = require('uuid')

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN
const ADMIN_EMAIL = process.env.ADMIN_EMAIL


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

let ALWAYS_AVAILABLE_CATEGORIES = ['Slogan']


const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || "").toLowerCase()
const VALID_PROVIDERS = ["dynamodb", "postgres"]
if (!VALID_PROVIDERS.includes(STORAGE_PROVIDER)) {
    console.error('Invalid or missing storage provider', STORAGE_PROVIDER)
    process.exit(-1)
}

const {
    populateStateCache,
    upsertIdRow,
    deleteIdRow,
} = require(`./${STORAGE_PROVIDER}.js`)



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
    res.send({ err: err })
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


async function updateOrder (cache, ids, upsertRow) {
    for (let i in ids) {
        let j = cache.findIndex(r => r.id == ids[i])
        if (j < 0) {
            // ignore any rows that are no longer present
        } else if (j == i) {
            // no swap needed, just update order if not already there
            if (cache[i].order != i) {
                cache[i].order = i
                upsertRow(cache[i])
            }
        } else {
            // swap the rows that have the current idx and the desired idx
            let tmp = cache[i]
            cache[i] = cache[j]
            cache[j] = tmp

            if (cache[i].order != i) {
                cache[i].order = i
                upsertRow(cache[i])
            }
            if (cache[j].order != j) {
                cache[j].order = j
                upsertRow(cache[j])
            }
        }
    }
}


async function upsertProjectRow (project) {
    return await upsertIdRow(
        TABLE_NAME_PROJECTS,
        state.projects,
        {
            'title' : {S: project.name},
            'description' : {S: project.description},
            'members' : {S: project.members},
            'slogan' : {S: project.slogan},
            'categoryId' : {S: project.categoryId},
            'authorEmail': {S: project.authorEmail},
            'sort': {N: '' + project.order},
            'createdAt': {N: '' + project.createdAt || ('' + Date.now())},
            'id' : {S: project.id || uuidv4()}
        }
    )
}

async function upsertProject (project) {
    if (project.id && state.projects.some(p => p.authorEmail != project.authorEmail && p.id == project.id)) {
        return {code: RESP_CODE_NOT_OWNER, msg: RESP_MSG_NOT_OWNER}
    }
    if (!project.name) {
        return {code: RESP_CODE_INVALID_DATA, msg: RESP_MSG_INVALID_DATA}
    }

    let oldCategoryVotes = state.votes.filter(v =>
        v.projectId == project.id && v.categoryId != project.categoryId
            && !ALWAYS_AVAILABLE_CATEGORIES.includes(v.categoryId)
    )
    // no transaction here: if subsequent project update fails, we've maybe deleted valid votes
    for (let vote of oldCategoryVotes) {
        console.log('Delete old vote', vote)
        await deleteIdRow(
            TABLE_NAME_VOTES,
            state.votes,
            vote.id
        )
    }

    return upsertProjectRow(project)
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
    console.log('Upsert project', req.body)
    let order = req.body.order < 0 ? '' + state.projects.length : req.body.order
    let err = await upsertProject({
        name: req.body.name,
        description: req.body.description,
        members: req.body.members,
        slogan: req.body.slogan,
        categoryId: req.body.categoryId,
        authorEmail: res.locals.email,
        order: order,
        createdAt: req.body.createdAt,
        id: req.body.id
    })
    sortStateProjects()
    stateDataOnSuccess(res, err)
})

app.post('/votes', async (req, res, next) => {
    console.log('Upsert vote', req.body)
    let err = await upsertVote(
        req.body.projectId,
        req.body.categoryId,
        res.locals.email,
        req.body.id
    )
    stateDataOnSuccess(res, err)
})

app.delete('/projects', async (req, res, next) => {
    console.log('Delete project', req.body)
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
    console.log('Delete vote', req.body)
    let err = await deleteIdRow(
        TABLE_NAME_VOTES,
        state.votes,
        req.body.id
    )
    stateDataOnSuccess(res, err)
})


app.use(async (req, res, next) => {
    if (res.locals.email == ADMIN_EMAIL) next()
    else
    {
        console.log('Invalid email for admin actions')
        res.send({ err: 'No' })
    }
})

app.post('/projects/order', async (req, res, next) => {
    console.log('Order projects', req.body)
    let err = await updateOrder(
        state.projects,
        req.body.projectIds,
        upsertProjectRow
    )
    sortStateProjects()
    stateDataOnSuccess(res, err)
})

app.post('/votes/dump', async (req, res, next) => {
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

app.post('/projects/dump', async (req, res, next) => {
    let categoryIdToDetails = dictByIdOfArray(state.categories)

    console.log('Projects dump')
    const HEADER = ['Winner	Timestamp	Title	Description	Members	Slogan  Category	Author\n']
    const projectRows = state.projects.map(
        project => [
            '__',
            '0:00:00',
            //project.id,
            project.name,
            project.description,
            project.members,
            project.slogan,
            categoryIdToDetails[project.categoryId],
            project.authorEmail,
            //project.createdAt,
        ].join("\t") + "\n"
    )
    res.send(HEADER.concat(projectRows).join(''))
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
    console.log("Categories", state.categories)
}

function sortStateProjects () {
    state.projects.sort((a, b) => {
        if (a.order > b.order) return 1
        if (a.order < b.order) return -1
        if (a.createdAt > b.createdAt) return 1
        if (a.createdAt < b.createdAt) return -1
        if (a.id > b.id) return 1
        if (a.id < b.id) return -1
        return 0
    })
}


async function init () {
    console.log(`Initializing Hack Day Voting Server...`)

    await populateStateCache(
        TABLE_NAME_CATEGORIES,
        state.categories,
        [
            'title',
            'id'
        ]
    )
    await populateHackDayCategories()
    ALWAYS_AVAILABLE_CATEGORIES = ALWAYS_AVAILABLE_CATEGORIES
        .map(name => state.categories.find(c => c.name == name).id)
    console.log("Hack Day Categories populated");//, state.categories

    await populateStateCache(
        TABLE_NAME_PROJECTS,
        state.projects,
        [
            'title',
            'description',
            'members',
            'slogan',
            'categoryId',
            'authorEmail',
            'sort',
            'createdAt',
            'id'
        ]
    )
    sortStateProjects()
    await populateStateCache(
        TABLE_NAME_VOTES,
        state.votes,
        [
            'projectId',
            'categoryId',
            'authorEmail',
            'id'
        ]
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
