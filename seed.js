
/*

aws dynamodb delete-table --table-name HackDayDev.Categories
aws dynamodb delete-table --table-name HackDayDev.Projects
aws dynamodb delete-table --table-name HackDayDev.Votes

Then yarn start to create tables
Copy category ids out of that for Company and Personal
Add those category ids to the list below
Then node seed.js to populate rows

*/


const uuidv4 = require('uuid')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL

const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || "").toLowerCase()

const { upsertIdRow } = require(`./${STORAGE_PROVIDER}.js`)

const TABLE_NAME_PROJECTS = 'HackDayDev.Projects'

let state = {
    projects: [],
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

async function init () {
    console.log(`Seeding Hack Day Dev Db...`)

    categoryIds = [
        'bf2ca5c6-bf6c-4870-bb21-c84e773fa426',
        '8c5f6f27-b021-4cea-b82e-17133b951c83',
    ]

    for (let i = 1; i < 30; i++) {
        let num = i < 10 ? '0' + i : '' + i
        let project = {
            name: 'n' + num,
            description: 'd' + num,
            members: 'm' + num,
            slogan: 's' + num,
            categoryId: categoryIds[i % categoryIds.length],
            authorEmail: ADMIN_EMAIL,
            order: i,
            createdAt: '',
            id: ''
        }
        console.log(project)
        await upsertProjectRow(project)
    }

    console.log(`Caches populated!`)//, state
    //console.log(`projects`, state.projects)
}

init().then((err) => {
    if (err) {
        console.log("Error in init", err)
    } else {
        console.log("Done")
    }
})
