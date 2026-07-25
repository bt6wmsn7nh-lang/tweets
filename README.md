{
  "name": "demon-slayer-tweet",
  "version": "2.0.0",
  "private": true,
  "description": "Multi-user Demon Slayer inspired social feed with PostgreSQL persistence.",
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "check": "node --check server.js"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "bcryptjs": "3.0.3",
    "express": "5.1.0",
    "pg": "8.22.0"
  }
}
