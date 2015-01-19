var fs = require('fsplus');
var path = require('path');
var geci = require('geci');
var mkdirp = require('mkdirp');
var Player = require('player');
var colors = require('colors');
var consoler = require('consoler');
var termList = require('term-list-enhanced');
var sdk = require('./sdk');
var utils = require('./utils');
var pkg = require('../package');
var errors = require('./errors');
var template = require('./template');

// the keypress shortcut list
var shorthands = {
  'return': 'play',
  'backspace': 'stop',
  'g': 'go',
  'l': 'loving',
  'n': 'next',
  'q': 'quit',
  's': 'share',
  'r': 'showLrc'
};

module.exports = Fm;

function Fm() {
  this.rc = {};
  this.syshome = utils.home();
  this.rc.profile = path.join(this.syshome, '.douban.fm.profile.json');
  this.rc.history = path.join(this.syshome, '.douban.fm.history.json');
  this.home = utils.readJSON(this.rc.profile).home || path.join(this.syshome, 'douban.fm');
  this.love = path.join(this.home, 'love');
  this.isShowLrc = false;
  template.updateTab('Douban FM');
  // ensure dir exists
  try {
    mkdirp.sync(this.love);
  } catch (err) {
    consoler.error(errors.setup_fail);
    throw err;
  }
};

function isChannel(alias, id) {
  if (alias === 'local' && id == -99) return true;
  if (alias === 'private' && (id == 0 || id == -3)) return true;
  return false;
}

/**
*
* Fetch songs and add them to playlist
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.fetch = function(channel, account, callback) {
  var self = this;
  var query = {};
  query.kbps = 192;
  query.history = self.rc.history;
  query.channel = channel.channel_id;
  query.local = isChannel('local', channel.channel_id) ? self.home : false;
  if (account) {
    query.token = account.token;
    query.user_id = account.user_id;
    query.expire = account.expire;
  }

  return sdk.songs(query, utils.isFunction(callback) ? callback : cb);

  function cb(err, songs, result) {
    if (err) return;
    if (!songs || songs.length === 0) return;
    if (!self.player) return;
    songs.forEach(function(song) {
      self.player.add(song);
    });
  }
}

/**
*
* Playing songs when everything is ready
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.play = function(channel, account) {
  var self = this;
  var menu = self.menu;
  var isVaildAccount = account && account.token;
  var privateMhz = isChannel('private', channel.channel_id) && !isVaildAccount;

  // Check if this kind of mHz is private
  if (privateMhz) return menu.update('header', errors.account_missing);

  // clear last label
  if (self.status === 'fetching' || self.status === 'downloading') return;
  if (self.status === 'playing' || self.status === 'error') {
    if (typeof(self.channel) != undefined) menu.clear(self.channel);
    if (self.player) {
      self.player.stop();
      delete self.player;
    }
  }

  // clear label status
  menu.clear('header');
  self.channel = channel.index;
  self.status = 'fetching';
  menu.update(channel.index, template.listing());
  try {
    fs.updateJSON(self.rc.profile, { lastChannel: channel });
  } catch (err) {};

  // start fetching songs
  self.fetch(channel, account, function(err, songs, result) {
    if (err) {
      self.status = 'error';
      return menu.update(channel.index, (err.toString().red));
    }
    // mark PRO account on logo
    if (result && !result.warning) menu.update('header', ' PRO '.inverse.yellow);
    self.status = 'ready';
    self.player = new Player(songs, {
      src: 'url',
      cache: true,
      downloads: self.home
    });
    self.player.play();
    self.player.on('downloading', function(url) {
      self.status = 'downloading';
      menu.update(channel.index, template.loading());
    });
    // update template
    self.player.on('playing', function(song) {
      var isValidSong = song.title && song.sid;
      self.status = 'playing';
      // update playing label
      menu.update('header', '>'.green);
      // update song infomation
      menu.update(channel.index, template.song(song));
      // logging songs history
      if (isValidSong) {
        var updates = {};
        updates[song.sid] = song;
        try {
          fs.updateJSON(self.rc.history, updates);
        } catch (err) {
          // error must be logged in a private place.
        }
      }
      // print LRC if needed.
      if (self.isShowLrc) {
        if (self.lrc) self.lrc.stop();
        geci.fetch(song, function(err, lrc) {
          if (err) return menu.update('header', (errors.lrc_notfound + err.toString()).grey);
          if (!lrc) return menu.update('header', (errors.lrc_notfound).grey);
          self.lrc = geci.print(lrc, function(line, extra) {
            menu.update(channel.index, template.song(song, line));
          });
        });
      }
      // 没有对尝试获取列表失败进行处理，如果失败2次，则不会再播放任何歌曲
      if (song._id < self.player.list.length - 1) return false;
      return self.fetch(channel, account);
    });
  });
}

/**
*
* Add current song to lovelist when pressing `L`
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.loving = function(channel, account) {
  if (!this.player) return false;
  if (!this.player.playing) return false;
  if (!this.player.playing.sid) return this.menu.update('header', errors.love_fail);
  if (!account) return this.menu.update('header', errors.account_missing);
  var self = this;
  var menu = self.menu;
  var song = self.player.playing;
  var query = {
    sid: song.sid,
    channel: self.channel,
    user_id: account.user_id,
    expire: account.expire,
    token: account.token
  };
  if (song.like) query.type = 'u';
  menu.update('header', '正在加载...');
  sdk.love(query, function(err, result) {
    menu.clear('header');
    if (err) menu.update('header', errors.normal);
    if (!err) self.player.playing.like = !song.like;
    return menu.update(
      self.channel,
      template.song(self.player.playing, null, true) // keep silence, do not notify
    );
  });
}

/**
*
* Play the next song in the playlist
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.next = function(channel, account) {
  if (!this.player) return false;
  var menu = this.menu;
  this.player.next(function(err, song) {
    if (err) menu.update('header', errors.last_song);
    return false;
  });
}

/**
*
* Stop playing
* and show the stopped status on logo.
*
**/
Fm.prototype.stop = function(channel, account) {
  if (!this.player) return false;
  if (this.status === 'stopped') return this.play(channel, account);
  var menu = this.menu;
  menu.clear('header');
  menu.update('header', template.pause());
  this.status = 'stopped';
  return this.player.stop();
}

/**
*
* Quit the Fm
* and kill the process when pressing `Q`
*
**/
Fm.prototype.quit = function() {
  this.menu.stop();
  return process.exit();
}

/**
*
* Goto the music album page when pressing `G`
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.go = function(channel, account) {
  if (!this.player) return false;
  if (!this.player.playing) return false;
  if (channel.channel_id == -99) return false;
  return utils.go(utils.album(this.player.playing.album));
}

/**
*
* Show lrc when when pressing `R`.
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.showLrc = function(channel, account) {
  if (channel.channel_id == -99) return false;
  this.isShowLrc = !!!this.isShowLrc;
  this.menu.clear('header');
  this.menu.update('header', this.isShowLrc ? '歌词开启' : '歌词关闭');
  return false;
}

/**
*
* Share the current playing songs to Weibo when pressing `S`.
* @channel[Object]
* @account[Object]
*
**/
Fm.prototype.share = function(channel, account) {
  if (!this.player || !this.player.playing) return false;
  return utils.go(template.share(this.player.playing));
}

/**
*
* Create command line interface menu
* using term-list-enhanced module
* @callback[Function]: the callback function when set down.
*
**/
Fm.prototype.createMenu = function(callback) {
  var self = this;
  // fetch channels
  sdk.fm.channels(function(err, list) {
    if (err) consoler.error(errors.turn_to_local_mode);
    // fetch configs, show user's infomations
    fs.readJSON(self.rc.profile, function(e, user) {
      var vaildAccount = user && user.account && user.account.user_name;
      var account = vaildAccount ? user.account : null;
      // init menu
      self.menu = new termList();
      self.menu.header(template.logo(account));
      var nav = [sdk.mhz.localMhz];
      self.menu.adds(nav.concat(!err ? [sdk.mhz.privateMhz].concat(list) : []));
      // bind keypress events
      self.menu.on('keypress', function(key, index) {
        if (!shorthands[key.name]) return false;
        return self[shorthands[key.name]](self.menu.items[index], account);
      });
      self.menu.on('empty', function() {
        self.menu.stop();
      });
      // check last played channel
      if (user && user.lastChannel) {
        self.play(user.lastChannel, account);
        self.menu.start(user.lastChannel.index);
        return false;
      }
      // start menu at line 2 (below the logo text)
      self.menu.start(1);
    });
  });
  // callback if necessary.
  return callback && callback();
}

/**
*
* Init douban.fm command line interface.
* @callback [Function]: the callback function when all set done
*
**/
Fm.prototype.init = function(callback) {
  var self = this;
  fs.exists(self.home, function(exist) {
    if (exist) return self.createMenu(callback);
    mkdirp(self.love, function(err) {
      if (err) return consoler.error(errors.mkdir_fail);
      return self.createMenu(callback);
    });
  });
}