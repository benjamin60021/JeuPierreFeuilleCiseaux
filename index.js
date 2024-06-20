const cluster = require("cluster")
const numCPUs = require("os").cpus().length
const { Socket } = require("socket.io")
const express = require("express")
const app = express()
const http = require("http").createServer(app)
const path = require("path")

const portBase = 8080
const chatMessages = []
let rooms = []

function roomId() {
  return Math.random().toString(36).substr(2, 9)
}

function createRoom(player) {
  const room = { id: roomId(), players: [] }
  player.roomId = room.id
  room.players.push(player)
  rooms.push(room)
  return room
}

function determineResult(player1, player2) {
  const hands = {
    rock: "pierre",
    paper: "feuille",
    scissors: "ciseaux",
    well: "puit",
  }
  const results = {
    pierre: { ciseaux: "gagne", feuille: "perd", well: "gagne" },
    feuille: { pierre: "gagne", ciseaux: "perd", well: "perd" },
    ciseaux: { feuille: "gagne", pierre: "perd", well: "gagne" },
    puit: { pierre: "gagne", feuille: "perd", ciseaux: "gagne" },
  }

  if (player1.hand === player2.hand) {
    return { tie: true }
  } else {
    const result = results[hands[player1.hand]][hands[player2.hand]]
    if (result === "gagne") {
      return { winner: player1, loser: player2 }
    } else {
      return { winner: player2, loser: player1 }
    }
  }
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`)

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork()
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`)
  })
} else {
  const io = require("socket.io")(http)

  app.use(
    "/bootstrap/css",
    express.static(path.join(__dirname, "node_modules/bootstrap/dist/css"))
  )
  app.use(
    "/bootstrap/js",
    express.static(path.join(__dirname, "node_modules/bootstrap/dist/js"))
  )
  app.use(
    "/jquery",
    express.static(path.join(__dirname, "node_modules/jquery/dist"))
  )

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"))
  })

  app.get("/games", (req, res) => {
    res.sendFile(path.join(__dirname, "jeu.html"))
  })

  io.on("connection", (socket) => {
    console.log(`[connection] ${socket.id}`)

    socket.on("restart game", (roomId) => {
      const room = rooms.find((r) => r.id === roomId)

      if (room) {
        room.players.forEach((player) => {
          player.hand = null
        })
        io.to(room.id).emit("restart game")
      }
    })

    socket.on("chat message", (msg) => {
      console.log(`[chat message] Received message: ${msg}`)
      io.emit("chat message", msg)
    })

    socket.on("playerData", (player) => {
      console.log(`[playerData] ${player.username}`)

      let room = null

      if (!player.roomId) {
        room = createRoom(player)
        console.log(`[create room ] - ${room.id} - ${player.username}`)
      } else {
        room = rooms.find((r) => r.id === player.roomId)

        if (room === undefined) {
          return
        }

        player.roomId = room.id
        room.players.push(player)
      }

      socket.join(room.id)

      io.to(socket.id).emit("join room", room.id)

      if (room.players.length === 2) {
        io.to(room.id).emit("start game", room.players)
      }
    })

    socket.on("get rooms", () => {
      io.to(socket.id).emit("list rooms", rooms)
    })

    socket.on("chooseHand", (data) => {
      const room = rooms.find((r) => r.id === data.roomId)

      if (!room) return

      const player = room.players.find((p) => p.socketId === socket.id)
      if (!player) return

      player.hand = data.hand

      const allPlayersChosen = room.players.every((p) => p.hand)

      if (allPlayersChosen) {
        const result = determineResult(room.players[0], room.players[1])
        io.to(room.id).emit("result", result)

        room.players.forEach((p) => (p.hand = null))
      }
    })

    socket.on("disconnect", () => {
      console.log(`[disconnect] ${socket.id}`)
      let room = null

      rooms.forEach((r) => {
        const index = r.players.findIndex((p) => p.socketId === socket.id)
        if (index !== -1) {
          r.players.splice(index, 1)

          if (r.players.length === 0) {
            rooms = rooms.filter((room) => room !== r)
          } else {
            io.to(r.id).emit("player left", r.players)
          }
        }
      })
    })
  })

  const server = http.listen(portBase + cluster.worker.id, () => {
    console.log(
      `Worker ${cluster.worker.id} started on http://localhost:${
        portBase + cluster.worker.id
      }/`
    )
  })
}
