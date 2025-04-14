'use strict'

const lernaConfig = require('../../lerna.json')
const { spawnCommand, printError, runMain } = require('../utils')
const { command } = require('../command')
const { modifyFile } = require('../files-utils')

const CHANGELOG_FILE = 'CHANGELOG.md'

runMain(async () => {
  if (!process.env.EDITOR) {
    printError('Please configure your environment variable EDITOR')
    process.exit(1)
  }

  const changesList = getChangesList()

  await modifyFile(
    CHANGELOG_FILE,
    (content) => `\
# Changelog

## v${lernaConfig.version}

${changesList}
${content.slice(content.indexOf('\n##'))}`
  )

  await spawnCommand(process.env.EDITOR, [CHANGELOG_FILE])

  command`git add ${CHANGELOG_FILE}`.run()
})

function getChangesList() {
  command`git fetch --tags -f -q`.run()
  const lastTagHash = command`git rev-list --tags --max-count=1`.run().trim()
  const lastTagName = command`git describe --tags ${lastTagHash}`.run()

  const commits =
    command`git log ${lastTagName.trimEnd()}..HEAD --pretty=format:%s`.run()
  const allowedChanges = commits
    .split('\n')
    .map((entry) => `- ${entry}`)
    .join('\n')
  // changes with pull request links
  return allowedChanges.replace(
    /\(#(\d+)\)/gm,
    (_, id) =>
      `([#${id}](https://gitlab.jiagouyun.com/cloudcare/dataflux-rum-sdk-javscript/pull/${id}))`
  )
}
