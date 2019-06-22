const vorpal = require('vorpal')();
const chalk = require('chalk');
const request = require("request-promise");

let token = "";
// Note - Testing
let sourceCategory = {
  "gameId": "xkdk4g1m",
  "categoryId": "z27340od",
  "subCategoryVarId": "j84koeyn",
  "subCategoryVarVal": "z19rj981",
  "mandatoryVariables": []
};
let destinationCategory = {
  "gameId": "kdkz25qd",
  "categoryId": "zdnx3y92",
  "subCategoryVarId": "6njqpm5l",
  "subCategoryVarVal": "jqzxvd21",
  "mandatoryVariables": [
    {
      "id": "wl33vxwl",
      "default": "4lxe09r1"
    }
  ]
};
// let sourceCategory = null;
// let destinationCategory = null;
let runsToBeSubmitted = [];

async function getCategories(gameName) {
  let resp = await request({
    uri: `https://www.speedrun.com/api/v1/games?name=${gameName}`,
    headers: {}
  });
  resp = JSON.parse(resp);
  // TODO - handle failure
  let gameContent = resp.data[0];
  let categoryUrl = "";
  for (var i = 0; i < gameContent.links.length; i++) {
    if (gameContent.links[i].rel === "categories") {
      categoryUrl = `${gameContent.links[i].uri}?embed=variables`;
    }
  }
  resp = await request({
    uri: categoryUrl,
    headers: {}
  });
  resp = JSON.parse(resp);
  let categoryContent = resp.data;
  // Build up a list of all categories / subcategories
  let categories = [];
  for (var i = 0; i < categoryContent.length; i++) {
    let category = categoryContent[i];
    // We aren't supporting levels right now!
    if (category.type !== "per-game") {
      continue;
    }
    let hasSubcategories = false;
    let mandatoryVariables = [];
    // TODO - this is dirty but it will work
    for (var j = 0; j < category.variables.data.length; j++) {
      let variable = category.variables.data[j];
      // If it is the version variable, store a mapping
      if (!variable["is-subcategory"] && variable["mandatory"]) {
        mandatoryVariables.push({
          id: variable.id,
          default: variable.values.default
        });
      }
    }
    // Look for sub-categories
    for (var j = 0; j < category.variables.data.length; j++) {
      let variable = category.variables.data[j];
      if (variable["is-subcategory"]) {
        hasSubcategories = true;
        for (const key of Object.keys(variable.values.values)) {
          let subCategory = variable.values.values[key];
          categories.push({
            name: `${category.name} - ${subCategory.label}`,
            value: {
              gameId: gameContent.id,
              categoryId: category.id,
              subCategoryVarId: variable.id,
              subCategoryVarVal: key,
              mandatoryVariables: mandatoryVariables
            }
          });
        }
      }
    }
    if (!hasSubcategories) {
      categories.push({
        name: `${category.name}`,
        value: {
          gameId: gameContent.id,
          categoryId: category.id,
          subCategoryVarId: null,
          subCategoryVarVal: null,
          mandatoryVariables: mandatoryVariables
        }
      })
    }
  }
  return categories;
}

function getVersionMapping() {

}

async function getRunsFromSource() {
  let leaderboardUrl = `https://www.speedrun.com/api/v1/leaderboards/${sourceCategory.gameId}/category/${sourceCategory.categoryId}`;
  if (sourceCategory.subCategoryVarId !== null) {
    leaderboardUrl += `?var-${sourceCategory.subCategoryVarId}=${sourceCategory.subCategoryVarVal}`;
  }
  let resp = await request({
    uri: leaderboardUrl,
    headers: {}
  });
  resp = JSON.parse(resp);
  // TODO - handle failure
  // Build up a list of all categories / subcategories
  let runs = [];
  for (var i = 0; i < resp.data.runs.length; i++) {
    let run = resp.data.runs[i].run;
    // We are assuming 1 player per run
    let preparedPlayer = run.players[0];
    // Fetch the user's name, workaround for SRC-API bug
    let playerName = "";
    if (preparedPlayer.rel === "guest") {
      playerName = preparedPlayer.name
    } else {
      let resp = await request({
        uri: preparedPlayer.uri,
        headers: {}
      });
      resp = JSON.parse(resp);
      playerName = resp.data.names.international;
    }
    delete preparedPlayer["uri"]
    let preparedRun = {
      run: {
        category: destinationCategory.categoryId,
        date: run.date,
        platform: run.system.platform,
        emulated: run.system.emulated,
        verified: false, // Runs won't be auto-verified
        times: {
          realtime: run.times.realtime_t,
        },
        // TODO - broken!
        // players: [
        //   preparedPlayer
        // ],
        comment: (run.comment == null) ? `${playerName}` : `${playerName} ${run.comment}`
      }
    };
    if (run.system.region !== null) {
      preparedRun.region = run.system.region;
    }
    if (run.videos !== null) {
      preparedRun.run.video = run.videos.links[0].uri;
    }
    if (run.splits !== null) {
      preparedRun.run.splitsio = run.splits.uri;
    }
    if (destinationCategory.subCategoryVarId !== null) {
      preparedRun.run.variables = {
        [destinationCategory.subCategoryVarId]: {
          type: "pre-defined",
          value: destinationCategory.subCategoryVarVal
        }
      }
    }
    // Add any mandatory variable's defaults
    // for (var j = 0; j < destinationCategory.mandatoryVariables.length; j++) {
    //   let variable = destinationCategory.mandatoryVariables[j];
    //   preparedRun.run.variables[variable.id] = {
    //     type: "pre-defined",
    //     value: variable.default
    //   };
    // }
    // Add version variable, HACK
    let consoleMapping = {
      // PS2
      n5e17e27: "4lxe09r1",
      // PS3
      mx6pwe3g: "8147kpj1",
      // PS4
      nzelkr6q: "z1985kkq"
    }
    preparedRun.run.variables["wl33vxwl"] = {
      type: "pre-defined",
      value: run.system.platform in consoleMapping ? consoleMapping[run.system.platform] : "4lxe09r1"
    };
    runs.push(preparedRun);
  }
  return runs;
}

vorpal
  .command('set token <token>', `Set's Speedrun.com's API Token - Can be Found Here: https://www.speedrun.com/api/auth`)
  .action(function (args, callback) {
    token = args.token;
    this.log(chalk.green(`Token set [${token}]`));
    callback();
  });

vorpal
  .command('select source <gameName>', `Retrieves all categories for a particular game and allows for source category selection.  For Example - "jak1"`)
  .action(async function (args, callback) {
    let gameName = args.gameName;
    let categories = await getCategories(gameName);
    console.log(chalk.green(`Found ${categories.length} categories!`));
    const self = this;
    this.prompt({
      type: 'list',
      name: 'categorySelection',
      message: 'Select a Source Category:',
      pageSize: 15,
      choices: categories
    }, function (result) {
      console.log(chalk.green(`Category Selected!\nGame ID - [${result.categorySelection.gameId}]\nCategory ID - [${result.categorySelection.categoryId}]\nSubcategory Variable ID - [${result.categorySelection.subCategoryVarId}]\nSubcategory Variable Value - [${result.categorySelection.subCategoryVarVal}]`));
      sourceCategory = result.categorySelection;
      vorpal.show();
    });
  });

vorpal
  .command('select destination <gameName>', `Retrieves all categories for a particular game and allows for destination category selection.  For Example - "jakext"`)
  .action(async function (args, callback) {
    let gameName = args.gameName;
    let categories = await getCategories(gameName);
    console.log(chalk.green(`Found ${categories.length} categories!`));
    const self = this;
    this.prompt({
      type: 'list',
      name: 'categorySelection',
      message: 'Select a Source Category:',
      pageSize: 15,
      choices: categories
    }, function (result) {
      console.log(chalk.green(`Category Selected!\nGame ID - [${result.categorySelection.gameId}]\nCategory ID - [${result.categorySelection.categoryId}]\nSubcategory Variable ID - [${result.categorySelection.subCategoryVarId}]\nSubcategory Variable Value - [${result.categorySelection.subCategoryVarVal}]`));
      destinationCategory = result.categorySelection;
      vorpal.show();
    });
  });

vorpal
  .command('prepare runs', `Retrieves all runs given the configured source/destination categories to be transferred.`)
  .action(async function (args, callback) {
    // TODO - check that source and destination are set
    let runs = await getRunsFromSource();
    console.log(chalk.green(`Found ${runs.length} runs to push!`));
    runsToBeSubmitted = runs;
    // console.log(JSON.stringify(runsToBeSubmitted));
    callback();
  });

vorpal
  .command('post runs', `POSTS runs to Speedrun.com`)
  .action(async function (args, callback) {
    // TODO - handle failure
    for (var i = 0; i < runsToBeSubmitted.length; i++) {
      let run = runsToBeSubmitted[i];
      try {
        let resp = await request({
          uri: `https://www.speedrun.com/api/v1/runs`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": token
          },
          json: run
        });
      } catch (err) {
        console.log(`Error Posting: ${JSON.stringify(run)}`);
      }
    }
    console.log(chalk.green(`Runs POSTed!`));
    runsToBeSubmitted = [];
    callback();
  });

vorpal.delimiter('sr-mover$');

function runCli() {
  // console.log(console.log(JSON.stringify(await getRunsFromSource(), null, 4)));
  vorpal.show();
}

module.exports.runCli = runCli;