/*
To push to github:
git status  // tells current status of files
git add // Adds changed files to record.  -A will add all files
git commit -m "message" // commits changes to be pushed
git push // pushes all changes to github
*/

const PLAYER_NUMBER = 4; //Keep this as 4.
const GAME_SPEED = 75; //Reccomended: 50-70 for good game visibility and speed. Speed unit of the game in milliseconds
const turnCount = 1000; //Reccomended: 1000 - 1500 for reasonable game time length. How many turns in a game. One turn is one player moving.
const randomMap = true; //Reccomended: true. This decides whether the map is randomely generated or not. Randomely generated maps are symmetrical. If this is false, then a map will be chosen from maps.json, predrawn maps.
const baseStealEnergy = 10; // The Amount of Energy Stolen from another player's base  Higher means more aggressive play 
const MAP_SIZE = 20; // Determines width and height of the map
const FLOWER_ADD = 4; // Increases the number of flowers on the map

//Import node modules
var fs = require("fs")
var http = require('http');
var path = require('path');
var PF = require('pathfinding');
var async = require('async');
var socketio = require('socket.io');
var express = require('express');
var PF = require('pathfinding');
var app = express();



var games = [];
var queueSockets = [];
var gameRunning = false;
var gameData = [{}, {}, {}, {}, {}];
var playerData = JSON.parse(fs.readFileSync("playerData.json"));
var maps = JSON.parse(fs.readFileSync("maps.json"))
var replay = JSON.parse(fs.readFileSync("replay.json"))
var router = express();
var server = http.createServer(router);
var io = socketio.listen(server);

router.use(express.static(path.resolve(__dirname, 'client')));
//5 Socket arrays to hold 4 socket connections per game, and there are 5 games max at once
var sockets = [
  [],
  [],
  [],
  [],
  []
];

var displays = [];
var cnt = 0;
var colors = ["orange", "red", "blue", "green"]; // Player colors

class Player { //Player constructor
  constructor(name, count, gameId, elo) {
    this.id = count;
    this.color = colors[count]
    this.name = name;
    this.pollen = 0;
    this.pos = [];
    this.pos.push(games[gameId].bases[count].pos[0]);
    this.pos.push(games[gameId].bases[count].pos[1]);
    this.elo = elo;
    this.dir = "";
  }
}


//Game function
function Game(gameId) {
  this.totalTurns = turnCount; //This should alawys be a multiple of the player number!
  this.running = false;
  this.gameId = gameId;
  this.map = "";
  this.players = [];
  this.idTurn = 0;
  this.turn = 0;
  this.mapSize = MAP_SIZE;
  this.socketIndex;
  //  let mapNum = Math.floor(Math.random() * maps.length);
  let mapNum = 0;
  this.mapNumber = mapNum;
  this.bases = generateBases();
  this.barricades = generateBarricades(mapNum, this.bases);
  if (reachable(this.bases[0].pos, this.bases[1].pos, this.barricades).length <= 1 || reachable(this.bases[0].pos, this.bases[3].pos, this.barricades) <= 1) {
    let blockArr = reachable(this.bases[0].pos, this.bases[1].pos, []).concat(reachable(this.bases[1].pos, this.bases[2].pos, [])).concat(reachable(this.bases[2].pos, this.bases[3].pos, [])).concat(reachable(this.bases[3].pos, this.bases[0].pos, []));
    for (let i = 0; i < blockArr.length; i++) {
      for (let j = 0; j < this.barricades.length; j++) {
        if (this.barricades[j][0] == blockArr[i][0] && this.barricades[j][1] == blockArr[i][1]) {
          this.barricades.splice(j, 1);
        }
      }
    }
  }

  this.flowers = generateNodes(this.bases, this.barricades, mapNum);
  //GENERATE NODES, THEN BASES KTHE NBARRICADES. HAVE A SUQARE FROM ALL THE BASES OFMOFO

}
//create 5 instances of the game function
games.push(new Game(games.length));
games.push(new Game(games.length));
games.push(new Game(games.length));
games.push(new Game(games.length));
games.push(new Game(games.length));

io.on('connection', function(socket) { // When a new player is registered, add them to the database after checking the same username doesn't exist.
  socket.on("newPlayer", function(obj) {
    console.log("Player requesting to register! Username: " + obj.username + ", key: " + obj.key)
    var hasUserName = false;
    for (let player in playerData) {
      if (playerData[player].username == obj.username || player == obj.key) {
        console.log("Registration denied, username exists.")
        hasUserName = true;
      }
    }

    if (obj.username == "" || obj.username === null) {
      hasUserName = true;
      console.log("Registration denied, username is null.");
    }
    if (!hasUserName) {
      playerData[obj.key] = { username: obj.username, score: 100 }
      fs.writeFileSync("playerData.json", JSON.stringify(playerData, null, 2))
      console.log("Registration authorized, user has been added to the playerDatabase!");
    }
  })
  /* @Desc: Takes new direction from player and determines new position
   * @Params: data{} - dir(srt): direction chosen by player - name(str): name of player sending data
   */
  socket.on("rerunGame", function(num) {

    socket.emit("rerunGameData", replay.games[num])
  })
  socket.on("new direction", function(data) {
    //checking the game turn is still on the player who sent this direction. If it's not, the direction sent is disregarded.  
    if (data.id == games[data.gameId].idTurn) {
      //changing the player's position based on the string, also making sure they're not going off the map or into a barricade.
      if (data.dir == "north" && games[data.gameId].players[data.id].pos[1] > 0 && checkCollide(games[data.gameId].players[data.id].pos[0], games[data.gameId].players[data.id].pos[1] - 1, games[data.gameId])) {
        games[data.gameId].players[data.id].pos[1]--;
      }
      else if (data.dir == "east" && games[data.gameId].players[data.id].pos[0] <= 18 && checkCollide(games[data.gameId].players[data.id].pos[0] + 1, games[data.gameId].players[data.id].pos[1], games[data.gameId])) {
        games[data.gameId].players[data.id].pos[0]++;
      }
      else if (data.dir == "south" && games[data.gameId].players[data.id].pos[1] <= 18 && checkCollide(games[data.gameId].players[data.id].pos[0], games[data.gameId].players[data.id].pos[1] + 1, games[data.gameId])) {
        games[data.gameId].players[data.id].pos[1]++;
      }
      else if (data.dir == "west" && games[data.gameId].players[data.id].pos[0] > 0 && checkCollide(games[data.gameId].players[data.id].pos[0] - 1, games[data.gameId].players[data.id].pos[1], games[data.gameId])) {
        games[data.gameId].players[data.id].pos[0]--;
      }
      games[data.gameId].players[games[data.gameId].idTurn].dir = data.dir;
    }



  });
  //Runs when someone connects to the display website
  socket.on("display", function() {
    displays.push(socket)
    //Sending name data for selection for replaying games
    let stringArr = [];
    let tempStr = "";
    for (let thing in replay.games) {
      tempStr = "";
      for (let i in replay.games[thing].players) {
        tempStr += replay.games[thing].players[i].name + ", ";
      }
      tempStr = tempStr.substring(0, tempStr.length - 2);
      if (replay.games[thing].winnerId != "tie") {
        tempStr += " | Winner: " + replay.games[thing].players[replay.games[thing].winnerId].name;
      }
      else {
        tempStr += " | Winner: Tie"
      }
      if (tempStr.length > 0) {
        stringArr.push(tempStr);
      }
    }


    var mostWins = [];
    for (var player in playerData) {
      mostWins.push([playerData[player].username, playerData[player].score]);
    }
    mostWins.sort(function(a, b) {
      return b[1] - a[1];
    });




    socket.emit("replayNames", { "rerunStr": stringArr, "scoreArray": JSON.stringify(mostWins) })
    socket.emit("queue", games);
  })
  socket.on("name", function(key) {
    console.log("user:" + key + " connected")
    //making sure the key is a key in the database.
    let tempname = checkKey(key);
    if (tempname) { //tempname is either false if authentification failed, or it is the name that associates with the key.
      socket.playerName = tempname.name;
      socket.elo = tempname.elo;
      queueSockets.push(socket);

      if (queueSockets.length >= PLAYER_NUMBER && !gameRunning) {
        /* 1. Shifts queud players into sockets 
         * 2. Creates Players in game object
         * 3. Starts running game
         * 4. sets gameRunning to true
         */
        startGame(queueSockets);
      }
    }
    else {
      console.log("player not found, or already connected?")
    }

  })
});

//Pass the array to go through as a parameter.
function broadcast(event, data, arr) {
  arr.forEach(function(socket) {
    socket.emit(event, data);
  });
}


server.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
  var addr = server.address();
  console.log("Server listening at", addr.address + ":" + addr.port);
});

function resetGame(gameToReset) {

  var energyArr = [];
  var winner = gameToReset.bases[0];
  for (var i = 0; i < gameToReset.bases.length; i++) {
    if (winner.pollen < gameToReset.bases[i].pollen) {
      winner = gameToReset.bases[i];
    }
    energyArr.push(gameToReset.bases[i].pollen);
  }
  energyArr = energyArr.sort(function(a, b) { return b - a; });
  //checking there isn't a tie between players
  if (energyArr[0] != energyArr[1]) {
    broadcast("endGame", { "winner": gameToReset.players[winner.id], "base": winner, "gameId": gameToReset.gameId }, sockets[gameToReset.gameId])
    broadcast("endGame", { "winner": gameToReset.players[winner.id], "base": winner, "gameId": gameToReset.gameId }, displays)
    addWin(gameToReset.players[winner.id].name)
    gameData[gameToReset.gameId].winnerId = winner.id;
  }
  else {
    gameData[gameToReset.gameId].winnerId = "tie";
    broadcast("endGame", { "winner": "tie", "gameId": gameToReset.gameId }, sockets[gameToReset.gameId])
    broadcast("endGame", { "winner": "tie", "gameId": gameToReset.gameId }, displays)
  }


  console.log("Game " + gameToReset.gameId + " has ended, and player " + winner.id + "(" + gameToReset.players[winner.id].name + ") won! ");

  console.log("Adding the turn data to the replay database.");
  replay.games.push(JSON.parse(JSON.stringify(gameData[gameToReset.gameId])));

  while (replay.games.length > 20) {
    replay.games.shift();
  }
  fs.writeFileSync("replay.json", JSON.stringify(replay))
  gameData[gameToReset.gameId] = {};


  gameToReset.players.length = 0;
  sockets[gameToReset.gameId].length = 0;

  games[gameToReset.gameId] = new Game(games.length);
  if (queueSockets.length >= PLAYER_NUMBER) {
    startGame(queueSockets)
  }
  else {
    gameToReset.running = false;
  }
}

function startGame(queued) {
  console.log("startGame running");
  let ind;

  for (let i = 0; i < games.length; i++) {
    if (!games[i].running) {
      ind = i;
      break;
    }
  }


  console.log("Game " + ind + " starting!");
  games[ind].gameId = ind;
  for (var i = 0; i < PLAYER_NUMBER; i++) {
    var oi = queued.shift();
    sockets[ind].push(oi);
    games[ind].players.push(new Player(oi.playerName, games[ind].players.length, games[ind].gameId, oi.elo));
  }
  games[ind].idTurn = 0;
  games[ind].running = true;
  broadcast("queue", "There are " + games[ind].players.length + " people connencted.", sockets[ind]);
  broadcast("queue", games, displays);
  broadcast("gameStart", games[ind], sockets[ind]);
  gameData[ind].turns = [];
  gameData[ind].players = JSON.parse(JSON.stringify(games[ind].players));
  gameData[ind].bases = JSON.parse(JSON.stringify(games[ind].bases))
  gameData[ind].flowers = JSON.parse(JSON.stringify(games[ind].flowers))
  gameData[ind].barricades = JSON.parse(JSON.stringify(games[ind].barricades))
  // gameData[ind].teleport = [];
  gameData[ind].pollen = [];


  var loop = setInterval(function() {
    if (games[ind].turn == games[ind].totalTurns + PLAYER_NUMBER) {
      broadcast("draw", games, displays);
      clearInterval(loop)
      resetGame(games[ind])

    }
    else {

      games[ind].idTurn = games[ind].turn % games[ind].players.length;



      //Adding position information to add to the database for replays
      let posGameData = games[ind].players[games[ind].idTurn].pos;
      // gameData[ind].turns.push(JSON.parse(JSON.stringify(posGameData)));

      gameData[ind].turns.push(JSON.parse(JSON.stringify(posGameData)));

      let turnData = {
        "bases": [games[ind].bases[0].pollen, games[ind].bases[1].pollen, games[ind].bases[2].pollen, games[ind].bases[3].pollen],
        "players": [games[ind].players[0].pollen, games[ind].players[1].pollen, games[ind].players[2].pollen, games[ind].players[3].pollen]
      }

      // if(gameData[ind].idTurn == ind % 4){
      gameData[ind].pollen.push(JSON.parse(JSON.stringify(turnData)));
      // }
      //adding energy to nodes
      if (games[ind].turn % 4 == 0) {
        for (var i = 0; i < games[ind].flowers.length; i++) {
          games[ind].flowers[i].pollen++;
        }
      }

      //checking player collision with nodes
      for (var i = 0; i < games[ind].flowers.length; i++) {
        if (games[ind].players[games[ind].idTurn].pos[1] == games[ind].flowers[i].pos[1] && games[ind].players[games[ind].idTurn].pos[0] == games[ind].flowers[i].pos[0]) {
          games[ind].players[games[ind].idTurn].pollen += games[ind].flowers[i].pollen;
          games[ind].flowers[i].pollen = 0;
        }
      }


      playerCollide(ind) //checks player collision
      checkBase(ind)


      games[ind].myBot = games[ind].players[games[ind].idTurn];
      games[ind].myBase = games[ind].bases[games[ind].idTurn];


      broadcast("draw", games, displays);
      sockets[ind][games[ind].idTurn].emit("update", games[ind]);

      games[ind].turn++;
    }

  }, GAME_SPEED);
}

// Changes ELO based on win/lose
function addWin(userName, playersInGame) {
  console.log("player data", playerData);

  for (let thing in playerData) {
    if (playerData[thing].username == userName) {
      playerData[thing].score += 15;
    }
    // else {
    //   playerData[thing].score -= 5;
    //   if (playerData[thing].score < 0) {
    //     playerData[thing].score = 0;
    //   }
    // }
  }
  // Save changes to playerData
  fs.writeFileSync("playerData.json", JSON.stringify(playerData, null, 2))
}



function checkKey(key) {
  let arr = Object.keys(playerData)
  for (let i = 0; i < arr.length; i++) {
    if (key == arr[i]) {

      for (let j = 0; j < queueSockets.length; j++) {
        if (playerData[key].username == queueSockets[j].playerName) {
          return false;
        }
      }
      for (let thing in games) {
        if (games[thing].players.length > 0) {
          for (var j = 0; j < games[thing].players.length; j++) {
            if (playerData[key].username == games[thing].players[j].name) {
              return false;

            }
          }
        }
      }


      return { "name": playerData[key].username, "elo": playerData[key].score };
    }
  }
  return false;

}

function checkCollide(x, y, game) {
  for (var i = 0; i < game.barricades.length; i++) {
    if (game.barricades[i][0] == x && game.barricades[i][1] == y) {
      return false;
    }
  }
  return true;
}

function checkBase(gameId) {
  let energyStolen = false;
  let playerInd;
  let baseInd;
  let energyGained;

  for (var i = 0; i < games[gameId].players.length; i++) {


    for (var j = 0; j < games[gameId].players.length; j++) {
      if (j != i) {
        if (games[gameId].players[j].pos[1] == games[gameId].bases[i].pos[1] && games[gameId].players[j].pos[0] == games[gameId].bases[i].pos[0]) {
          if (games[gameId].bases[i].pollen >= baseStealEnergy) {

            energyGained = baseStealEnergy;

          }
          else {
            energyGained = games[gameId].bases[i].pollen;
          }

          if (games[gameId].players[i].pos[0] == games[gameId].players[j].pos[0] && games[gameId].players[i].pos[1] == games[gameId].players[j].pos[1]) {
            games[gameId].bases[i].pollen += games[gameId].players[j].pollen;
            games[gameId].players[j].pollen = 0;
            games[gameId].players[j].pos[0] = games[gameId].bases[j].pos[0];
            games[gameId].players[j].pos[1] = games[gameId].bases[j].pos[1];
            energyGained = 0;
          }
          energyStolen = true;


          playerInd = j;
          baseInd = i;


        }
      }
    }
    if (games[gameId].players[i].pos[1] == games[gameId].bases[i].pos[1] && games[gameId].players[i].pos[0] == games[gameId].bases[i].pos[0]) {
      games[gameId].bases[i].pollen += games[gameId].players[i].pollen
      games[gameId].players[i].pollen = 0;
    }
  }

  if (energyStolen) {

    games[gameId].players[playerInd].pollen += energyGained;
    games[gameId].bases[baseInd].pollen -= energyGained;
  }
}

function playerCollide(ind) {
  for (var i = 0; i < games[ind].players.length; i++) {
    for (let j = 0; j < games[ind].players.length; j++) {
      if (j != i) {
        const avg = games[ind].players[i].pollen + games[ind].players[j].pollen;
        if ((games[ind].players[j].pos[1] != games[ind].bases[i].pos[1] && games[ind].players[j].pos[0] != games[ind].bases[i].pos[0])) {
          if (games[ind].players[i].pos[1] == games[ind].players[j].pos[1] && games[ind].players[i].pos[0] == games[ind].players[j].pos[0]) {
            if (games[ind].players[i].pollen > games[ind].players[j].pollen) {
              games[ind].players[i].pollen = Math.ceil(avg / 2)
              games[ind].players[j].pollen = Math.floor(avg / 2)
            }
            else if (games[ind].players[i].pollen < games[ind].players[j].pollen) {
              games[ind].players[j].pollen = Math.ceil(avg / 2)
              games[ind].players[i].pollen = Math.floor(avg / 2)
            }
          }
        }

      }
    }
  }
}

function generateBases() {
  let bases = [{ pos: [1, 1], pollen: 0, id: 0 }, { pos: [18, 1], pollen: 0, id: 1 }, { pos: [1, 18], pollen: 0, id: 2 }, { pos: [18, 18], pollen: 0, id: 3 }];
  if (randomMap) {
    let r = [Math.ceil(Math.random() * (MAP_SIZE - 2)), Math.ceil(Math.random() * (MAP_SIZE - 2))]
    let arr = mirrorPos(r);
    bases[0].pos = arr[0];
    bases[1].pos = arr[1];
    bases[2].pos = arr[2];
    bases[3].pos = arr[3];
  }
  return bases;
}


function mirrorPos(initPos) { // given a position, return an array with that position mirroed across all quadrants.
  let arr = [];
  arr.push(initPos)
  let tempPos = JSON.parse(JSON.stringify(initPos));
  tempPos[0] = Math.abs((MAP_SIZE - 1) - tempPos[0]);
  arr.push(JSON.parse(JSON.stringify(tempPos)));
  tempPos[1] = Math.abs((MAP_SIZE - 1) - tempPos[1]);
  arr.push(JSON.parse(JSON.stringify(tempPos)));
  tempPos = JSON.parse(JSON.stringify(initPos));
  tempPos[1] = Math.abs((MAP_SIZE - 1) - tempPos[1]);
  arr.push(JSON.parse(JSON.stringify(tempPos)));
  return arr;
}

function generateNodes(bases, barricades, mapNum) {
  if (!randomMap) {
    return JSON.parse(JSON.stringify(maps[mapNum].flowers));
  }
  let nodeNum = (Math.ceil(Math.random() * 4 + FLOWER_ADD));
  let nodeArr = [];

  for (let i = 0; i < nodeNum; i++) {
    let tempPos = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];

    for (let j = 0; j < bases.length; j++) {
      if (tempPos[0] == bases[j][0] && tempPos[1] == bases[j][1]) {
        tempPos = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];
        j = 0;
      }
    }
    for (let i = 0; i < nodeArr.length; i++) {
      if (tempPos[0] == nodeArr[i][0] && tempPos[1] == nodeArr[i][1]) {
        tempPos = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];
        i = 0;
      }
    }
    for (let j = 0; j < barricades.length; j++) {
      if (tempPos[0] == barricades[j][0] && tempPos[1] == barricades[j][1]) {
        tempPos = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];
        j = 0;
      }
    }
    for (let n = 0; n < bases.length; n++) {
      var onBase = false;
      if (tempPos[0] == bases[n].pos[0] && tempPos[1] == bases[n].pos[1]) {
        onBase = true;
      }
    }

    if (reachable(bases[0].pos, tempPos, barricades).length <= 1 || onBase) {
      i--;
    }
    else {

      let mirrorPoss = mirrorPos(tempPos);
      nodeArr.push({ pollen: 0, pos: mirrorPoss[0] });
      nodeArr.push({ pollen: 0, pos: mirrorPoss[1] });
      nodeArr.push({ pollen: 0, pos: mirrorPoss[2] });
      nodeArr.push({ pollen: 0, pos: mirrorPoss[3] });
    }
  }
  return nodeArr;
}

function generateBarricades(mapNum, bases) {
  // console.log("bases: " + bases)
  let arr = [];
  if (!randomMap) {
    return (JSON.parse(JSON.stringify(maps[mapNum].barricades)))
  }
  let barricadeNum = (Math.ceil(Math.random() * MAP_SIZE)) + 30;
  for (let j = 0; j < barricadeNum; j++) {
    let r = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];
    for (let i = 0; i < bases.length; i++) {
      if (r[0] == bases[i].pos[0] && r[1] == bases[i].pos[1]) {
        r = [Math.floor(Math.random() * MAP_SIZE), Math.floor(Math.random() * MAP_SIZE)];
        i = 0;
      }
    }



    let mirrorPoss = mirrorPos(r)
    arr.push(mirrorPoss[0])
    arr.push(mirrorPoss[1])
    arr.push(mirrorPoss[2])
    arr.push(mirrorPoss[3])
  }


  return arr;
}

function reachable(pos1, pos2, barricades) {
  var grid = new PF.Grid(20, 20);
  grid.setWalkableAt(pos1[0], pos1[1], true);
  grid.setWalkableAt(pos2[0], pos2[1], true);
  for (let i = 0; i < barricades.length; i++) {
    grid.setWalkableAt(barricades[i][0], barricades[i][1], false)
  }
  var finder = new PF.AStarFinder();
  var path = finder.findPath(pos1[0], pos1[1], pos2[0], pos2[1], grid);
  return path;
}
