// server.js
// Demon Slayer Tweet backend
// Part 1 of 3

const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================
   REQUIRED ENVIRONMENT VARIABLES
========================================= */

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET is missing. Add a long random SESSION_SECRET in Render."
  );
}

/* =========================================
   POSTGRESQL CONNECTION
========================================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false
        }
      : false
});

/* =========================================
   EXPRESS SETTINGS
========================================= */

app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

/* =========================================
   LOGIN SESSION SETTINGS
========================================= */

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),

    name: "demon_slayer_session",

    secret:
      process.env.SESSION_SECRET ||
      "development-only-change-this-session-secret",

    resave: false,
    saveUninitialized: false,
    rolling: true,

    cookie: {
      httpOnly: true,

      secure:
        process.env.NODE_ENV === "production",

      sameSite: "lax",

      maxAge:
        1000 *
        60 *
        60 *
        24 *
        14
    }
  })
);

/* =========================================
   PUBLIC WEBSITE FILES
========================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================
   HELPER FUNCTIONS
========================================= */

function cleanString(value, maximumLength) {
  return String(value ?? "")
    .trim()
    .slice(0, maximumLength);
}

function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio || "",
    avatar_style:
      row.avatar_style || "water",
    created_at: row.created_at
  };
}

function requireLogin(req, res, next) {
  if (
    !req.session ||
    !req.session.userId
  ) {
    return res.status(401).json({
      error: "You must be logged in."
    });
  }

  next();
}

/* =========================================
   DATABASE TABLE CREATION
========================================= */

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,

      username VARCHAR(20) NOT NULL,

      display_name VARCHAR(30) NOT NULL,

      password_hash TEXT NOT NULL,

      bio VARCHAR(160)
        NOT NULL
        DEFAULT '',

      avatar_style VARCHAR(20)
        NOT NULL
        DEFAULT 'water',

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX
    IF NOT EXISTS users_username_lower_unique

    ON users (
      LOWER(username)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,

      user_id BIGINT
        NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      content VARCHAR(280)
        NOT NULL,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      user_id BIGINT
        NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      post_id BIGINT
        NOT NULL
        REFERENCES posts(id)
        ON DELETE CASCADE,

      created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),

      PRIMARY KEY (
        user_id,
        post_id
      )
    );
  `);

  console.log(
    "Database tables are ready."
  );
}

/* =========================================
   HEALTH CHECK
========================================= */

app.get(
  "/api/health",

  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      return res.json({
        ok: true,
        database: "connected"
      });
    } catch (error) {
      console.error(
        "Health check error:",
        error
      );

      return res.status(500).json({
        ok: false,
        database: "disconnected"
      });
    }
  }
);

/* =========================================
   GET CURRENT LOGGED-IN USER
========================================= */

app.get(
  "/api/me",

  async (req, res) => {
    try {
      if (
        !req.session ||
        !req.session.userId
      ) {
        return res.json({
          user: null
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            username,
            display_name,
            bio,
            avatar_style,
            created_at

          FROM users

          WHERE id = $1

          LIMIT 1
          `,
          [
            req.session.userId
          ]
        );

      if (
        result.rows.length === 0
      ) {
        req.session.destroy(
          () => {}
        );

        return res.json({
          user: null
        });
      }

      return res.json({
        user: publicUser(
          result.rows[0]
        )
      });
    } catch (error) {
      console.error(
        "Current-user error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not load your account."
      });
    }
  }
);

/* =========================================
   SIGN UP
========================================= */

app.post(
  "/api/signup",

  async (req, res) => {
    try {
      const displayName =
        cleanString(
          req.body.displayName,
          30
        );

      const username =
        cleanString(
          req.body.username,
          20
        ).toLowerCase();

      const password =
        String(
          req.body.password ?? ""
        );

      if (
        !displayName ||
        !username ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Display name, username, and password are required."
        });
      }

      if (
        !/^[a-z0-9_]{3,20}$/.test(
          username
        )
      ) {
        return res.status(400).json({
          error:
            "Username must be 3–20 characters and use only letters, numbers, and underscores."
        });
      }

      if (
        displayName.length < 2
      ) {
        return res.status(400).json({
          error:
            "Display name must be at least 2 characters."
        });
      }

      if (
        password.length < 8 ||
        password.length > 72
      ) {
        return res.status(400).json({
          error:
            "Password must be between 8 and 72 characters."
        });
      }

      const existingUser =
        await pool.query(
          `
          SELECT id

          FROM users

          WHERE LOWER(username) =
                LOWER($1)

          LIMIT 1
          `,
          [
            username
          ]
        );

      if (
        existingUser.rows.length > 0
      ) {
        return res.status(409).json({
          error:
            "That username is already taken."
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO users (
            username,
            display_name,
            password_hash,
            bio,
            avatar_style
          )

          VALUES (
            $1,
            $2,
            $3,
            '',
            'water'
          )

          RETURNING
            id,
            username,
            display_name,
            bio,
            avatar_style,
            created_at
          `,
          [
            username,
            displayName,
            passwordHash
          ]
        );

      const newUser =
        result.rows[0];

      req.session.userId =
        newUser.id;

      await new Promise(
        (resolve, reject) => {
          req.session.save(
            (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            }
          );
        }
      );

      return res
        .status(201)
        .json({
          user:
            publicUser(newUser)
        });
    } catch (error) {
      console.error(
        "Signup error:",
        error
      );

      if (
        error &&
        error.code === "23505"
      ) {
        return res.status(409).json({
          error:
            "That username is already taken."
        });
      }

      return res.status(500).json({
        error:
          "Could not create your account."
      });
    }
  }
);
/* =========================================
   LOG IN
========================================= */

app.post(
  "/api/login",

  async (req, res) => {
    try {
      const username =
        cleanString(
          req.body.username,
          20
        ).toLowerCase();

      const password =
        String(
          req.body.password ?? ""
        );

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Username and password are required."
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            username,
            display_name,
            password_hash,
            bio,
            avatar_style,
            created_at

          FROM users

          WHERE LOWER(username) =
                LOWER($1)

          LIMIT 1
          `,
          [
            username
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(401).json({
          error:
            "Incorrect username or password."
        });
      }

      const user =
        result.rows[0];

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!passwordMatches) {
        return res.status(401).json({
          error:
            "Incorrect username or password."
        });
      }

      req.session.userId =
        user.id;

      await new Promise(
        (resolve, reject) => {
          req.session.save(
            (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            }
          );
        }
      );

      return res.json({
        user:
          publicUser(user)
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not log in."
      });
    }
  }
);

/* =========================================
   LOG OUT
========================================= */

app.post(
  "/api/logout",

  (req, res) => {
    if (!req.session) {
      return res.json({
        success: true
      });
    }

    req.session.destroy(
      (error) => {
        if (error) {
          console.error(
            "Logout error:",
            error
          );

          return res.status(500).json({
            error:
              "Could not log out."
          });
        }

        res.clearCookie(
          "demon_slayer_session"
        );

        return res.json({
          success: true
        });
      }
    );
  }
);
/* =========================================
   CORPS FEED
========================================= */

app.get(
  "/api/feed",

  async (req, res) => {
    try {
      const currentUserId =
        req.session &&
        req.session.userId
          ? req.session.userId
          : null;

      const result =
        await pool.query(
          `
          SELECT
            posts.id,
            posts.user_id,
            posts.content,
            posts.created_at,

            users.username,
            users.display_name,
            users.avatar_style,

            COUNT(
              likes.post_id
            )::INTEGER AS like_count,

            CASE
              WHEN $1::BIGINT IS NULL
              THEN FALSE

              ELSE EXISTS (
                SELECT 1

                FROM likes
                  AS current_user_like

                WHERE
                  current_user_like.post_id =
                    posts.id

                  AND
                  current_user_like.user_id =
                    $1
              )
            END AS liked_by_me

          FROM posts

          INNER JOIN users
            ON users.id =
               posts.user_id

          LEFT JOIN likes
            ON likes.post_id =
               posts.id

          GROUP BY
            posts.id,
            users.id

          ORDER BY
            posts.created_at DESC

          LIMIT 100
          `,
          [
            currentUserId
          ]
        );

      return res.json({
        posts:
          result.rows
      });
    } catch (error) {
      console.error(
        "Feed error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not load the Corps Feed."
      });
    }
  }
);
/* =========================================
   CREATE A POST
========================================= */

app.post(
  "/api/posts",

  requireLogin,

  async (req, res) => {
    try {
      const content =
        cleanString(
          req.body.content,
          280
        );

      if (!content) {
        return res.status(400).json({
          error:
            "Tweet cannot be empty."
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO posts (
            user_id,
            content
          )

          VALUES (
            $1,
            $2
          )

          RETURNING
            id,
            user_id,
            content,
            created_at
          `,
          [
            req.session.userId,
            content
          ]
        );

      return res
        .status(201)
        .json({
          post:
            result.rows[0]
        });
    } catch (error) {
      console.error(
        "Create-post error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not post your tweet."
      });
    }
  }
);

/* =========================================
   LIKE OR UNLIKE A POST
========================================= */

app.post(
  "/api/posts/:id/like",

  requireLogin,

  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const postId =
        Number(req.params.id);

      if (
        !Number.isSafeInteger(postId) ||
        postId < 1
      ) {
        return res.status(400).json({
          error:
            "Invalid tweet ID."
        });
      }

      await client.query(
        "BEGIN"
      );

      const postExists =
        await client.query(
          `
          SELECT id

          FROM posts

          WHERE id = $1

          FOR UPDATE
          `,
          [
            postId
          ]
        );

      if (
        postExists.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          error:
            "Tweet not found."
        });
      }

      const existingLike =
        await client.query(
          `
          SELECT 1

          FROM likes

          WHERE user_id = $1
            AND post_id = $2
          `,
          [
            req.session.userId,
            postId
          ]
        );

      let liked;

      if (
        existingLike.rows.length > 0
      ) {
        await client.query(
          `
          DELETE FROM likes

          WHERE user_id = $1
            AND post_id = $2
          `,
          [
            req.session.userId,
            postId
          ]
        );

        liked = false;
      } else {
        await client.query(
          `
          INSERT INTO likes (
            user_id,
            post_id
          )

          VALUES (
            $1,
            $2
          )
          `,
          [
            req.session.userId,
            postId
          ]
        );

        liked = true;
      }

      const countResult =
        await client.query(
          `
          SELECT
            COUNT(*)::INTEGER
              AS like_count

          FROM likes

          WHERE post_id = $1
          `,
          [
            postId
          ]
        );

      await client.query(
        "COMMIT"
      );

      return res.json({
        liked,
        likeCount:
          countResult
            .rows[0]
            .like_count
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Like-post error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not update that like."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================
   DELETE A POST
========================================= */

app.delete(
  "/api/posts/:id",

  requireLogin,

  async (req, res) => {
    try {
      const postId =
        Number(req.params.id);

      if (
        !Number.isSafeInteger(postId) ||
        postId < 1
      ) {
        return res.status(400).json({
          error:
            "Invalid tweet ID."
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM posts

          WHERE id = $1
            AND user_id = $2

          RETURNING id
          `,
          [
            postId,
            req.session.userId
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            "Tweet not found or you do not own it."
        });
      }

      return res.json({
        success: true
      });
    } catch (error) {
      console.error(
        "Delete-post error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not delete that tweet."
      });
    }
  }
);
/* =========================================
   UPDATE PROFILE
========================================= */

app.patch(
  "/api/profile",

  requireLogin,

  async (req, res) => {
    try {
      const displayName =
        cleanString(
          req.body.displayName,
          30
        );

      const bio =
        cleanString(
          req.body.bio,
          160
        );

      const avatarStyle =
        cleanString(
          req.body.avatarStyle,
          20
        ).toLowerCase();

      const allowedStyles =
        new Set([
          "water",
          "flame",
          "mist",
          "thunder",
          "flower"
        ]);

      if (
        displayName.length < 2
      ) {
        return res.status(400).json({
          error:
            "Display name must be at least 2 characters."
        });
      }

      if (
        !allowedStyles.has(
          avatarStyle
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid breathing style."
        });
      }

      const result =
        await pool.query(
          `
          UPDATE users

          SET
            display_name = $1,
            bio = $2,
            avatar_style = $3

          WHERE id = $4

          RETURNING
            id,
            username,
            display_name,
            bio,
            avatar_style,
            created_at
          `,
          [
            displayName,
            bio,
            avatarStyle,
            req.session.userId
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          error:
            "Account not found."
        });
      }

      return res.json({
        user:
          publicUser(
            result.rows[0]
          )
      });
    } catch (error) {
      console.error(
        "Update-profile error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not update your profile."
      });
    }
  }
);

/* =========================================
   UNKNOWN API ROUTES
========================================= */

app.use(
  "/api",

  (req, res) => {
    return res.status(404).json({
      error:
        "API route not found."
    });
  }
);

/* =========================================
   SEND INDEX.HTML FOR WEBSITE ROUTES
========================================= */

app.get(
  "*",

  (req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================
   SERVER ERROR HANDLER
========================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Unexpected server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      error:
        "An unexpected server error occurred."
    });
  }
);

/* =========================================
   START SERVER
========================================= */

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",

      () => {
        console.log(
          `Demon Slayer Tweet is running on port ${PORT}.`
        );
      }
    );
  } catch (error) {
    console.error(
      "Could not start server:",
      error
    );

    process.exit(1);
  }
}

startServer();
