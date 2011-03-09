var io = require('socket.io'),
  http = require('http'),
  sys = require('sys'),
  //redis = require('redis-client'),
  fs = require('fs'),
  ejs = require('ejs'),
  url = require('url'),
  path = require('path'),
  util = require('util'),
  dmpmod = require('diff_match_patch');

var dmp = new dmpmod.diff_match_patch();
  
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

    var snapshot_html = "";
    
    if (lines_ord.length != 0) {
      for (line_num in lines_ord) {
        snapshot_html += '<p data-uuid="' + lines_ord[line_num] + '">' + (lines[lines_ord[line_num]] || '') + '</p>';
      }
    }
    
    var pad_layout = ejs.render(html_file_pad, {
      encoding: 'utf8',
      locals: {
        snapshot: snapshot_html,
      }
    });
    
    var html_layout = ejs.render(html_file_layout, {
      encoding: 'utf8',
      locals: {
        content: pad_layout,
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
  lines_ord = new Array(),
  lines = new Object();
  edits = new Array(),
  changeset = 0,
  chat = new Array(),
  users = new Array();

lines["1"] = "first document";
lines_ord.push("1");

socket.on('connection', function(client){
  log("opened connection: "+client.sessionId);
  
  var self = client;
  
  /*for(var edit_id in edits) {
    client.send(edits[edit_id]);
    log("gesendet: "+edits[buff_id]);
  }*/

  current_user_id = client.user_id = ++user_count;
  
  users.push(client.user_id);
  
  client.send('{"channel": "initial", "id":' + current_user_id + ', "users":' + JSON.stringify(users) + '}');
  log("gesendet: "+'{"channel": "initial", "id":' + current_user_id + ', "users":[' + JSON.stringify(users) + '] }');
  client.broadcast('{"channel": "join", "payload": {"user": '+client.user_id+'}}');
  log("gesendet: "+'{"channel": "join", "payload": {"user": '+client.user_id+'}}');

  client.on('message', function(data) {
    log(client.sessionId + ": "+JSON.stringify(data));
    
    message_obj = JSON.parse(data);
    channel = message_obj["type"];
    msg = message_obj["message"];
    timestamp = new Date().getTime();
 
    //store snapshot
    if(channel == "snapshot"){
      // TODO: snapshot
      /*sys.puts(serialized_message);
      main_store.set('pad-snapshot', serialized_message, function(){});*/
    }
    //send all the exisiting diff messages
    else if(channel == "playback"){
      for(var edit_id in edits) {
        client.send(edits[edit_id]);
      }
      
      client.send('{"channel": "playback_done", "payload": ""}');
    }
    else if(channel == "chat") {
      serialized_message = JSON.stringify({"channel": channel, "payload": {"user": client.user_id, "message": msg, "timestamp": timestamp}});
      log("gesendet: "+serialized_message);
      
      client.broadcast(serialized_message);
      chat.push(serialized_message);
    }
    else {
      change = ++changeset;
      
      switch(channel) {
        case "add_line":
          addLine(msg);
          break;
        case "modify_line":
          modifyLine(msg);
          break;
        case "remove_line":
          removeLine(msg);
          break;
      }
      
      serialized_message = JSON.stringify({"channel": channel, "payload": {"user": client.user_id, "message": msg, "timestamp": timestamp, "changeset": change}});
      log("gesendet: "+serialized_message);
      
      client.broadcast(serialized_message);
      edits.push(serialized_message);
    }
  });
  
  client.on('disconnect', function() {
    client.broadcast('{"channel": "leave", "user": '+client.user_id+'}');
    var pos = users.indexOf(client.user_id);
    if (pos >= 0) {
      users.splice(pos, 1);
    }
  });

});

//To add a line we need:
//it's uuid, previous line uuid and next line uuid and content 
var addLine = function(msg){
  var uuid  = msg["uuid"];
  var content = msg["content"] || "";

  //find the line with next uuid
  var next_line = lines_ord.indexOf(msg["next_uuid"]);
  var previous_line = lines_ord.indexOf(msg["previous_uuid"]);

  if(next_line != -1){
    //insert before next uuid
    lines[uuid] = content;
    lines_ord.splice(next_line, 0, uuid);
  }
  //else find the line with previous uuid
  else if(previous_line != -1){
    //insert after previous uuid
    lines_ord.splice(previous_line+1, 0, uuid);
  }
  else {
    // insert as the first line
    lines_ord.unshift(uuid);
  }
};

//To modify a line we need:
// the uuid of the line and diff
var modifyLine = function(msg){
  var uuid = msg["uuid"];
  var patch = msg["content"];
  var current_text = lines[uuid] || "";

  var results = dmp.patch_apply(patch, current_text);
  
  log("patch: [uuid="+uuid+"|patch="+JSON.stringify(patch)+"|current="+current_text+"|result="+results+"]");
  
  lines[uuid] = results[0];
};

//To remove a line we need:
// the uuid of the line
var removeLine = function(msg){
  var uuid = msg["uuid"];

  lines_ord.splice(lines_ord.indexOf(uuid), 1);
  delete lines[uuid];
};



app.listen(8888);
