services:
  - type: web
    name: demon-slayer-tweet
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: demon-slayer-tweet-db
          property: connectionString

databases:
  - name: demon-slayer-tweet-db
    plan: free
    databaseName: demon_slayer_tweet
    user: demon_slayer_tweet_user
