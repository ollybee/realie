var io = require('socket.io'),
  http = require('http'),
  sys = require('sys'),
  //redis = require('redis-client'),
  fs = require('fs'),
  ejs = require('ejs'),
  url = require('url'),
  path = require('path'),
  util = require('util');
  
var html_file_pad = fs.readFileSync(__dirname + '/views/pad.html.ejs', 'utf8'),
  html_file_layout = fs.readFileSync(__dirname + '/views/layout.ejs', 'utf8');

//var main_store = redis.createClient();

// stolen from https://github.com/arunjitsingh/socket-chat/blob/master/app.js
// BEGIN
function findType(uri) {
  var types = {
    '.js': 'text/javascript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.manifest':'text/cache-manifest',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };

  var ext = uri.match(/\.\w+$/gi);
  if (ext && ext.length > 0) {
    ext = ext[0].toLowerCase();
    if (ext in types) {
      return types[ext];
    }
  }
  return undefined;
}

function sendError(code, response) {
  response.writeHead(code);
  response.end();
  return;
}
// END

var app = http.createServer(function(req, res) {
  var uri = url.parse(req.url).pathname;
  
  if (uri == '/' || uri == '/pad') {

    /*main_store.get('pad-snapshot', function(err, reply){
        if(reply){
          sys.puts(JSON.parse(reply.toString('utf8'))["message"]);
          sys.puts("parsed");
          var reply_lines = JSON.parse(reply.toString('utf8'))["message"].split("\n"); 
          var html_lines = [];
          for(var line_no in reply_lines){
            html_lines.push("<div>" + reply_lines[line_no] + "</div>"); 
          }
          var snapshot_html = html_lines.join("");
        }
        else 
          var snapshot_html = "";

        //var html_pad = ejs.render(html_file_pad, {
        //  encoding: 'utf8',
        //  locals: {
        //    snapshot: snapshot_html,
        //  }
        //});
        
        var html_layout = ejs.render(html_file_layout, {
          encoding: 'utf8',
          locals: {
            snapshot: snapshot_html,
          }
        });
        
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end(html_layout);
    });*/
    
    var snapshot_html = "";
    
    var html_layout = ejs.render(html_file_layout, {
      encoding: 'utf8',
      locals: {
        snapshot: snapshot_html,
      }
    });
        
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html_layout);
    
  } else {
  
    var _file = path.join(process.cwd(), 'public', uri);
    
    path.exists(_file, function(exists) {
      if (!exists) {
        sendError(404, res);
      } else {
        fs.stat(_file, function(err, stat) {
          //var file = __dirname + uri,
          var file = _file,
            type = findType(uri),
            size = stat.size;
          if (!type) {
            sendError(500, res);
          }
          log('GET ' + file);
          res.writeHead(200, {'Content-Type':type, 'Content-Length':size});
          var rs = fs.createReadStream(file);
          util.pump(rs, res, function(err) {
            if (err) {
              console.log("ReadStream, WriteStream error for util.pump");
              res.end();
            }
          });
        });
      }
    });
  }
  
});

function log(data){
  sys.log("\033[0;32m"+data+"\033[0m");
}

var user_count = 0;

var socket = io.listen(app),
  buffer = [],
  users = [];

socket.on('connection', function(client){
  log("opened connection: "+client.sessionId);
  
  var self = client;

  /*client.redis_subscriber = redis.createClient(); 
  client.redis_publisher = redis.createClient(); 

  client.redis_subscriber.subscribeTo("*",
    function (channel, message, subscriptionPattern) {
      var output = '{"channel": "' + channel + '", "payload": ' + message + '}';
      
      client.send(output);
  });*/
  
  for(var buff_id in buffer) {
    client.send(buffer[buff_id]);
    log("gesendet: "+buffer[buff_id]);
  }

  current_user_id = client.user_id = ++user_count;

  //store the current user's id on global store
  /*main_store.rpush('pad-users', current_user_id, function(err, reply){
    main_store.lrange('pad-users', 0, -1, function(err, values){
      client.send('{"channel": "initial", "id":' + current_user_id + ', "users":[' + values + '] }');
 
         main_store.lrange('pad-chat', 0, -1, function(err, messages){
           for(var msg_id in messages){
             client.send('{"channel": "chat", "payload": ' + messages[msg_id] + '}');
           }
         });
 
         //publish the message when joining
         redis_publisher.publish("join", JSON.stringify({"user": client.user_id}),
         function (err, reply) {
           sys.puts(err);
           sys.puts("Published message to " +
           (reply === 0 ? "no one" : (reply + " subscriber(s).")));
         });
    });  
  });*/
  
  users.push(client.user_id);
  
  client.send('{"channel": "initial", "id":' + current_user_id + ', "users":' + JSON.stringify(users) + '}');
  log("gesendet: "+'{"channel": "initial", "id":' + current_user_id + ', "users":[' + JSON.stringify(users) + '] }');
  client.broadcast('{"channel": "join", "payload": {"user": '+client.user_id+'}}');
  log("gesendet: "+'{"channel": "join", "payload": {"user": '+client.user_id+'}}');

  client.on('message', function(data) {
    log(client.sessionId + ": "+JSON.stringify(data));
    
    message_obj = JSON.parse(data);
    channel = message_obj["type"];
    message = message_obj["message"];
    timestamp = new Date().getTime();
    //serialized_message = JSON.stringify({"user": this.user_id, "message": message, "timestamp": timestamp, "channel": channel });
    serialized_message = JSON.stringify({"channel": channel, "payload": {"user": client.user_id, "message": message, "timestamp": timestamp}});
    log("gesendet: "+serialized_message);
 
    //store snapshot
    if(channel == "snapshot"){
      // TODO: snapshot
      /*sys.puts(serialized_message);
      main_store.set('pad-snapshot', serialized_message, function(){});*/
    }
    //send all the exisiting diff messages
    else if(channel == "playback"){
      /*main_store.lrange('pad-1', 0, -1, function(err, messages){
        for(var msg_id in messages){
          log(messages[msg_id]);
          var parsed_msg = JSON.parse(messages[msg_id]); //this is a dirty hack REMOVE!
          client.send('{"channel":"' + parsed_msg['channel'] + '", "payload": ' + messages[msg_id] + '}');
        }

        //once all messages sent, send a playback complete message
        client.send('{"channel": "playback_done", "payload": "" }');
      });*/
      
      for(var buff_id in buffer) {
        client.send(buffer[buff_id]);
      }
      
      client.send('{"channel": "playback_done", "payload": ""}');
    }
    else {
      /*client.redis_publisher.publish(channel, serialized_message,
        function (err, reply) {
          sys.puts("Published message to " +
            (reply === 0 ? "no one" : (reply + " subscriber(s).")));
          //store the messages on main store
          main_store.rpush('pad-1', serialized_message, function(err, reply){});
      });*/
      client.broadcast(serialized_message);
      buffer.push(serialized_message);
    }
  });
  
  client.on('disconnect', function() {

   //publish a message before leaving 
    /*client.redis_publisher.publish("leave", JSON.stringify({"user": client.user_id}),
      function (err, reply) {
        sys.puts(err);
        sys.puts("Published message to " +
          (reply === 0 ? "no one" : (reply + " subscriber(s).")));
    });
     
    client.redis_publisher.close();
    client.redis_subscriber.close();*/
    
    client.broadcast('{"channel": "leave", "user": '+client.user_id+'}');
    var pos = users.indexOf(client.user_id);
    if (pos >= 0) {
      users.splice(pos, 1);
    }
  });

});

app.listen(8888);
