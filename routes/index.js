
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: 'Express' });
//  console.log(appze);
//  next();
//  console.log(app.get('env'));
};
exports.clock = function(req, res){
  res.render('raphaeljs_clock', { title: 'Raphael Clock'});
};
