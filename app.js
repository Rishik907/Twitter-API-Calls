const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB error ${e}`);
    process.exit(1);
  }
};

initializeDBAndServer();
let logged_in_user;

// authentication
function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
}

// check whether user1 is following user2

const followingCheck = async (request, response, next) => {
  const { tweetId } = request.params;
  const { user_id } = logged_in_user;
  const userIdOfFollowingQuery = `
    SELECT user_id from tweet 
    WHERE tweet_id = ${tweetId}
    `;
  const userIdOfFollowing = await db.get(userIdOfFollowingQuery);
  const userFollowerQuery = `
  SELECT follower_user_id FROM follower 
  WHERE follower_user_id = ${user_id} AND
   following_user_id = ${userIdOfFollowing.user_id}
  `;
  const userFollower = await db.get(userFollowerQuery);
  if (userFollower === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//registering user

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const checkingUser = await db.get(selectUserQuery);
  if (checkingUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const userInsertQuery = `INSERT INTO user (name,username,password,gender)
    VALUES ('${name}','${username}','${hashedPassword}','${gender}')`;
    response.status(200);
    response.send("User created successfully");
  }
});

// login user

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbCheckUserQuery = await db.get(checkUserQuery);
  if (dbCheckUserQuery === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const comparePassword = await bcrypt.compare(
      password,
      dbCheckUserQuery.password
    );
    if (comparePassword === true) {
      const payLoad = {
        username: username,
      };
      logged_in_user = dbCheckUserQuery;
      const jwtToken = jwt.sign(payLoad, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//get tweets of the user follows

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { user_id } = logged_in_user;
  const getTweetsQuery = `SELECT username,tweet,date_time as dateTime
   from (user INNER JOIN follower ON
    user.user_id = follower.following_user_id
    ) AS T INNER JOIN tweet on T.user_id=tweet.user_id
    WHERE T.follower_user_id = ${user_id}
    ORDER BY dateTime DESC
    LIMIT 4
  `;
  const followersTweets = await db.all(getTweetsQuery);
  response.send(followersTweets);
});

//list of all names of people whom the user follows

app.get("/user/following", authenticateToken, async (request, response) => {
  const { user_id } = logged_in_user;
  const userFollowingQuery = `SELECT name FROM
    user inner join follower on user.user_id = follower.following_user_id
    WHERE follower_user_id = ${user_id};
    `;
  const userFollowers = await db.all(userFollowingQuery);
  response.send(userFollowers);
});

// list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { user_id } = logged_in_user;
  const followingUserQuery = `
  SELECT name FROM user INNER JOIN follower ON 
  user.user_id = follower.follower_user_id
  WHERE following_user_id = ${user_id}
  `;
  const followingUser = await db.all(followingUserQuery);
  response.send(followingUser);
});

// request the tweet of following users

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  followingCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweetDetailsQuery = `
  SELECT tweet.tweet as tweet, COUNT(like_id) as likes , count(reply_id) as replies,
  tweet.date_time as dateTime FROM (tweet INNER JOIN reply on
    tweet.tweet_id = reply.tweet_id) as T INNER JOIN
    like on T.tweet_id = like.tweet_id
    WHERE tweet.tweet_id = ${tweetId}
  `;
    const tweetDetails = await db.get(tweetDetailsQuery);
    response.send(tweetDetails);
  }
);

//request for like of a tweet

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  followingCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweetLikesQuery = `
    SELECT user.username as likes FROM  
    user INNER JOIN like on user.user_id = like.user_id 
    WHERE like.tweet_id = ${tweetId}
    `;
    const tweetLike = await db.all(tweetLikesQuery);
    let newArray = [];
    tweetLike.forEach((element) => {
      newArray.push(element["likes"]);
    });
    response.send({ likes: newArray });
  }
);

//request for reply of tweet

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  followingCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const replyQuery = `
    SELECT user.name as name , reply.reply as reply FROM 
    (user INNER JOIN reply ON user.user_id = reply.user_id)
    WHERE reply.tweet_id = ${tweetId}
    `;
    const reply = await db.all(replyQuery);
    const replyArray = [];
    reply.forEach((element) => {
      replyArray.push(element);
    });
    response.send({ replies: replyArray });
  }
);

// return a list of all tweets of users

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { user_id } = logged_in_user;
  const usersTweetsQuery = `
  SELECT tweet.tweet as tweet, count(like_id) as likes
  ,count(reply_id) as replies, tweet.date_time as dateTime
  FROM (tweet INNER JOIN like ON tweet.tweet_id = 
    like.tweet_id) as T INNER JOIN reply ON 
    T.tweet_id = reply.tweet_id 
    WHERE T.user_id = ${user_id}
  `;
  const usersTweets = await db.all(usersTweetsQuery);
  response.send(usersTweets);
});

// create a tweet

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = logged_in_user;
  const currentDate = new Date();

  const dateTime = currentDate.toISOString().slice(0, 10).replace("T", " ");

  console.log(`Current Date and Time: ${dateTime}`);
  const createTweetQuery = `
    INSERT INTO 
      tweet (tweet,user_id,date_time)
    VALUES 
      ("${tweet}",${user_id},${dateTime})
    `;
  const createTweet = await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// delete user tweet

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { user_id } = logged_in_user;
    const checkTweetQuery = `
    SELECT * FROM tweet 
      WHERE 
    tweet_id = ${tweetId} AND user_id = ${user_id}
      `;
    const checkTweet = await db.get(checkTweetQuery);
    if (checkTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteUserTweetQuery = `
        DELETE FROM tweet WHERE tweet_id = ${tweetId}
        `;
      await db.run(deleteUserTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
