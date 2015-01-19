var sys = require('sys');
var colors = require('colors');
var printf = require('sprintf').sprintf;
var exec = require('child_process').exec;
var notifier = new require('node-notifier')();
var utils = require('./utils');
var pkg = require('../package');

exports.logo = function(account) {
  return printf(
    '%s %s %s',
    'Douban FM'.green,
    ('v' + pkg.version).green.dim,
    account ? ('/ ' + account.user_name).green.bold : ''
  );
}

exports.notify = function(song) {
  notifier.notify({
    title: song.notifyTitle || 'Douban FM',
    open: song.open || pkg.repository.url,
    message: song.text || pkg.name + ' v' + pkg.version
  });
}

// BUG: 只有一个 tab 的时候这个 func 会导致 tab 页面闪动
exports.updateTab = function(str) {
  exec('printf "\\e]1;' + str + '\\a"',
    function(error, stdout, stderr) {
      sys.puts(stdout);
    }
  );
}

exports.title = function(str) {
  if (!str) return false;
  // this.updateTab(str);
  return (str).green;
}

exports.listing = function() {
  return this.title('加载列表中，请稍等...')
}

exports.loading = function() {
  return this.title('歌曲缓冲中，请稍等..')
}

exports.pause = function() {
  this.title('Douban FM');
  return '||'.red;
}

exports.song = function(s, selectText, silence) {
  var label = '♫ ';
  var song = s.title ? s : {};
  if (!song.title) {
    song.text = label + '未知曲目...'.red;
    if (!silence) this.notify(song);
    return (song.text).grey;
  }
  song.text = label + song.title + ' - ' + song.artist;
  song.open = utils.album(song.album);
  if (!silence) this.notify(song);
  return printf(
    '%s %s %s %s %s %s %s %s',
    song.like == 1 ? '♥'.red : '♥'.white,
    (song.title).magenta,
    (song.kbps + 'kbps').trap.blue,
    ('... ♪ ♫ ♫ ♪ ♫ ♫ ♪ ♪ ...').rainbow,
    selectText || (song.albumtitle).yellow,
    selectText ? '' : '•'.magenta,
    selectText ? '' : (song.artist).cyan,
    selectText ? '' : (song.public_time).blue
  )
}

exports.share = function(song) {
  var shareText = 
    'http://service.weibo.com/share/share.php?' +
    '&type=button' +
    '&appkey=3374718187' +
    '&ralateUid=1644105187' +
    '&url=' +
    pkg.repository.url +
    '&pic=' +
    (song.picture ? song.picture.replace('mpic', 'lpic') : '') +
    '%7C%7C' +
    'http://ww1.sinaimg.cn/large/61ff0de3tw1ecij3dq80bj20m40ez75u.jpg' +
    '&title=' +
    encodeURIComponent([
      '我正用豆瓣电台命令行版 v' + pkg.version + ' 收听 ',
      song.title ? '「' + song.title + '」' : '本地电台频道',
      song.kbps ? song.kbps + 'kbps' : '',
      song.albumtitle ? song.albumtitle + ' • ' : '',
      song.artist || '',
      song.public_time || '',
      song.album ? utils.album(song.album) : ''
    ].join(' '));
  // windows 下终端 & 需要转义
  if (process.platform === 'win32') shareText = shareText.replace(/&/g, '^&');
  return shareText;
}