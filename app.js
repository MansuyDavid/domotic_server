/**
 * Module dependencies.
 */
var express = require('express')
var routes = require('./routes')
var user = require('./routes/user')
var http = require('http')
var path = require('path');
var exec = require('child_process').exec;
var nano = require('nano');
var util = require('util');

var app = express();
var bdd;
var config;

main(0);

/**
 * fonction principale rapelee par les sous fonctions.
 * gere les appels aux sous-fonctions par rapport au numero d'etape
 * param etape (int) avancement dans le lancement du serveur
 *       objet (doc) parametres supplementaires necessaires
 */
function main(etape, objet){
  if (etape == 0) {
    lecture_config(0); // lit le fichier config/config.json
  }
  if (etape == 10){
    connexionCouchDB(10); //teste la connexion a couchDB
  }
  if (etape == 20){
    verificationDSS(20); // verifie que le DSS est accessible
  }
  if (etape == 30){
    tokenExistInBDD(30); // verifie que l'application possede un token en BDD
  }
  if (etape == 31){
    askForToken(etape); // demande un token au DSS et le stocke
  }
  if (etape == 32){                           //insere le nouveau
    saveToken(etape, config.applicationToken);//token dans la bdd
  }
  if (etape == 33) {                  //demande a l'utilisateur
    getIdentifiantsUtilisateur(etape);//ses identifiants
  }
  if (etape == 34) {                                   //demande au DSS un
    getSessionToken(etape, objet.pseudo, objet.password);//token de Session
  }
  if (etape == 35) {                           //tente de valider le token de
    validateApplicationToken(etape, objet.sessionToken);//l'application
  }
  if (etape == 40 || etape == 36) {
    connexionDSS(40); // tente de s'authentifier aupres du DSS
  }
  if (etape == 50) {
    compareTimeNodeDSS([getDSSMeters, getDSSSeries, lancementServeur]);
  }
}

/**
 * affiche le message d'erreur a l'utilisateur et termine le programme.
 * param: message  le message a afficher a l'utilisateur
 *        object   objet a afficher (erreur par exemple)
 */
function errorExit(message, objet) {
  if (objet == undefined) {
    console.error('\n' + message);
  }else {
    console.error('\n' + message, objet);
  }
  process.exit(-1);
}

/**
 * lit le fichier config/config.json et appele checkConfig pour
 * verifier sa bonne formation.
 */
function lecture_config(numEtape) {
  process.stdout.write("lecture de config/config.json ... ");
  var child = exec('cat ./config/config.json',
    function(error, stdout, stderr){
      if (error !== null ||
          stderr !=='' ||
          stdout ==''){
        errorExit('exec "cat ./config/config.json" error:\n' + error
                + '\nexec "cat ./config/config.json" stderr:\n' + stderr);
      }
      config = JSON.parse(stdout);
      //a faire try/catcher le parsage
      config.DSS.applicationName = escape(config.DSS.applicationName);
      config.DSS.jsonURL = 'https:\/\/' + config.DSS.ip + ':'
                           + config.DSS.port + '/json/';
      var result_checkConfig = checkConfig(config);
      if (result_checkConfig !== true){
        errorExit("ERR (checkConfig) : " + result_checkConfig);
      }
      console.log('OK');
      main(numEtape+10);
    }
  );
}

/**
 * verifie que le document config est correct.
 */
function checkConfig(config){
  if (config == undefined || config ==''){ return 'variable "config" undefined';}
  if (config.couchdb == undefined){ return 'le champ "couchdb" du fichier config.json n\'existe pas';}
  if (config.couchdb.ip == undefined ||
      config.couchdb.port == undefined ||
      config.couchdb.dbName == undefined) {
    return 'le champ couchdb du fichier config.json n\'est pas complet, il doit comporter :\n\tip\n\tport\n\tdbName';
  }
  if (config.refreshTime == undefined) { return 'le champ refreshTime n\'est pas defini';}
  if (typeof(config.refreshTime) !== 'number' ||
      parseInt(config.refreshTime)!==config.refreshTime ||
      config.refreshTime < 2000 ||
      config.refreshTime > 60000) {
    return 'le champ refreshTime ne contient pas un entier valide';
  }
  var result_checkDSS = checkDSS(config.DSS);
  if (result_checkDSS != true) {
    return result_checkDSS;
  }
  return true; 
}

/**
 * tente de se connecter a couchDB.
 */
function connexionCouchDB(numEtape){
  process.stdout.write('connexion a la base de donnee ... ');
  bdd = nano('http://'
                 + config.couchdb.ip + ':' + config.couchdb.port
                 + '/' + config.couchdb.dbName);
  bdd.list(function(e, b, h){
    if(e){
      errorExit("ERR (connexionCouchDB): le SGBD  n\'est pas joignable"
                + " ou la base de donnee \""+config.couchdb.dbName+"\" n\'"
                + "existe pas\nerreur : ", e);
    }else{
      console.log("OK");
      main(numEtape + 10);
    }
  });
}

/**
 * verifie que le champs "DSS" du fichier config.json est complet
 * return  true  si pas de problemes
 *         str   message d'information indiquant l'erreur
 */
function checkDSS(DSS){
  if (DSS == undefined ||
      DSS.ip == undefined ||
      DSS.port == undefined ||
      DSS.applicationName == undefined) {
    return "le champ DSS est mal defini";
  }
  return true;
}

/**
 * se charge de verifier que le DSS est accessible
 * param: numEtape  le numero d'etape fourni par main()
 */
function verificationDSS(numEtape){
  process.stdout.write('contact du serveur DSS ... ');
  //verification de l'adresse du DSS par envoie d'une requete
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/version';
  var child = exec(str,
    function(error, stdout, stderr){
      if (error !== null || stderr !=='' || stdout ==''){
        errorExit('erreur, le serveur DSS n\'est pas accessible, verifiez l\''
                + 'adresse indiquee dans'
                + ' le fichier config.json, champ DSS'
                + '\nexec "' + str + '" error:\n' + error
                + '\nexec "' + str + '" stderr:\n' + stderr
                + '\nstdout : ' + stdout);
      }
      var reponse;
      try{
        reponse = JSON.parse(stdout);
      } catch(err) {
        errorExit("\nERR (verificationDSS) : erreur lors du parsage de stdout" +
                  "de la commande"
                  + str + "\n" + err +
                  "verifiez le fichier config.json");
      }
      //on teste que la reponse recu est bien celle attendue
      if (reponse == undefined || reponse.ok == undefined ||
          reponse.ok == false){
        errorExit("\nERR (verificationDSS) : reponse non valide du DSS: ",
                  reponse);
      } else {
        console.log('OK');
        main(numEtape + 10);
      }
    }
  );
}

/**
 * teste si le token existe bien dans la bdd
 * appel a main : +1  si le document dss_config n'existe pas dans la BDD
 *                    et que l'utiisateur autorise sa creation et la
 *                    demande d'un token au DSS
 *                    ou
 *                    si le document ne contient pas le champ
 *                    applicationToken et que l'utilisateur autorise une
 *                    demande de token au DSS
 *                +10 si le token existe bien dans la bdd
 */
function tokenExistInBDD(numEtape) {
  process.stdout.write('lecture du token dans la BDD ... ');
  //on teste si on a un applicationToken dans la bdd
  bdd.get('dss_configuration', function(e, b, h){
    if (e) { //si le document n'existe pas
      console.log('\nle document "dss_configuration" de la base de '
                  + 'donnees n\'existe pas\nil sera cree lors de la demande '
                  + 'd\'autorisation d\'acces aupres du DSS');
      questionUtilisateur('Voulez vous continuer?',
                          {"y":{'fonction':function(){main(numEtape + 1);}},
                           "n":{'fonction':function(){
                                errorExit('rien ne sera insere dans la base' +
                                ' de donnee \nl\'application doit pouvoir ' +
                                'etre enregistre aupres du serveur DSS pour' +
                                ' pouvoir fonctionner.')}}
                          }
      );
    }else { // si le document existe bien
      if (b.applicationToken == undefined) {
        console.log('\nle token n\'existe pas dans le document "dss_config" '
                  + ' de la base de donnees\nun nouveau token va etre demande'
                  + ' au DSS puis stocke dans la BDD');
        questionUtilisateur('Voulez vous continuer?',
                          {"y":{'fonction':function(){main(numEtape + 1);}},
                           "n":{'fonction':function(){
                                errorExit('rien ne sera insere dans la base' +
                                ' de donnee \nl\'application doit pouvoir ' +
                                'etre enregistre aupres du serveur DSS pour' +
                                ' pouvoir fonctionner.')}}
                          }
        );
        
      } else {
        //le token est bien dans la bdd
        console.log('OK');
        config.applicationToken = b.applicationToken
        main(numEtape + 10);
      }
    }
  });
}

/*
 * pose une question a l'utilisateur et attend sa reponse.
 * params :
 *      question (string) question a poser a l'utilisateur
 *      reponses_correctes (document) {'format':{function, param} }
 *           format : string acceptee
 *             "*" pour accepter n'importe quelle string
 *           function : callback
 *           param : [tableau] le premmier parametre de la fonction
 */
function questionUtilisateur(question, reponses_correctes) {
  var str = '',
      i;
  for( i in reponses_correctes){
    str = str + '[' + i + ']';
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  console.log(question+'\nchoix possibles : '+str);
  process.stdin.once('data', function(chunk){
    chunk = chunk.replace('\n','');
    //si la string est reconnue
    if (reponses_correctes[chunk] !== undefined){
      //si on a pas de parametres a passer a la fonction
      if (reponses_correctes[chunk].param == undefined){
        reponses_correctes[chunk].fonction();
      }else{
        reponses_correctes[chunk].fonction(reponses_correctes[chunk].param);
      }
    } else {
      //si il existe le format joker
      if (reponses_correctes['*']!==undefined){
        if(reponses_correctes['*'].param == undefined){
          reponses_correctes['*'].fonction();
        }else{
          reponses_correctes['*'].fonction(reponses_correctes['*'].param, chunk)
        }
      }else{
        console.log('reponse incorrecte');
        questionUtilisateur(question, reponses_correctes);
      }
    }
  });
}

/*
 * demande un nouveau token au DSS au nom de l'application
 */
function askForToken(numEtape){
  //demande de token au DSS
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/'
            + 'requestApplicationToken?applicationName='
            + config.DSS.applicationName;
  var child = exec(str,
    function(error, stdout, stderr){
      reponse = checkDSSreponse(error,stdout,stderr, 'askForToken', str);
      //on teste que la reponse recu est bien celle attendue
      if (reponse.result == undefined ||
          reponse.result.applicationToken == undefined){
        errorExit("\nERR (askForToken) : reponse innatendue du DSS: ",
                  reponse);
      } else {
        //on a bien recu le token
        config.applicationToken = reponse.result.applicationToken;
        main(numEtape + 1);
      }
    }
  );
}

/*
 * enregistre le token dans la base de donnee.
 * callback : main(numEtape+1)
 */
function saveToken(numEtape, applicationToken) {
  var doc = { '_id' :'dss_configuration' };
  //get du document
  bdd.get('dss_configuration',function(e, b, h){
      if(!e && b!==undefined){
        doc = b;
      } else {
        errorExit('(saveToken) erreur d\'acces au document ' +
                  'dss_configuration', e);
      }
      //modification du document
      doc.applicationToken = applicationToken;
      //insertion dans la bdd
      bdd.insert(doc,function(e, b, h){
          if(e || b==undefined || b.ok==undefined || b.ok==false){
            errorExit('(savetoken) le token n\a pas reussi a etre ' +
                      ' insere dans la bdd', e);
          }
          console.log('le nouveau token a bien ete insere dans la bdd');
          main(numEtape+1);
      });
  });
}

/*
 * demande les identifiants utilisateur pour se connecter au DSS
 * callback : main(numEtape+1, {pseudo:'string', password:'string'})
 */
function getIdentifiantsUtilisateur(numEtape, pseudo, password){
  //si num etape contient un tableau avec les autres arguments
  if (typeof numEtape === 'object'){
    if (numEtape.length == 1){
      numEtape = numEtape[0];
    }else {
      password = pseudo;
      pseudo = numEtape[1];
      numEtape = numEtape[0];
    }
  }
  if(pseudo!==undefined && password!==undefined) {
    main(numEtape+1,{'pseudo':pseudo, 'password':password})
    //demande de token temporaire au DSS
  }else{
  if(pseudo == undefined){
    //demande du  pseudo  a l'utilisateur
    var question = "l'application doit s'authentifier aupres du serveur,\n" +
                   "indiquez le pseudo de connexion au DSS ou tapez 'a' pour" +
                   " annuler,\nmais dans ce cas vous devrez confirmer " +
                   "manuellement le token via l'interface du DSS";
    var str = "vous devez maintenant autoriser manuellement le token dans " +
              "l'interface du DSS";
    var reps = {'a':{'fonction':function(){errorExit(str);}} ,
                '*':{'fonction':getIdentifiantsUtilisateur,
                     'param':[numEtape]}};
    questionUtilisateur(question, reps);
  }else{
  if(password == undefined){
    //demande du password a l'utilisateur
    var question = "indiquez le password de connexion au DSS";
    var reps = {'*':{'fonction':getIdentifiantsUtilisateur,
                     'param':[numEtape, pseudo]}};
    questionUtilisateur(question, reps);
  }}}
}

/*
 * demande un token de Session au DSS.
 * callback: main(numEtape+1, {sessionToken:'string'})
 */
function getSessionToken(numEtape, pseudo, password){
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/'
            + 'login?user=' + pseudo + '\\&password=' + password;
  var child = exec(str,
    function(error, stdout, stderr){
      var reponse = checkDSSreponse(error,stdout,stderr,'getSessionToken',str);
      //on teste que la reponse recu est bien celle attendue
      if (reponse.result == undefined ||
          reponse.result.token == undefined){
        errorExit("\nERR (getSessionToken) : reponse innatendue du DSS: ",
                  reponse);
      } else {
        //on a bien recu le token
        //on retourne le token a la fonction main
        main(numEtape + 1, {"sessionToken" : reponse.result.token});
      }
    }
  );
}

/*
 * tente de valider le token de l'application grace au token de session
 */
function validateApplicationToken(numEtape, sessionToken){
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/'
            + 'enableToken?applicationToken=' + config.applicationToken
            + '\\&token=' + sessionToken;
  var child = exec(str,
    function(error, stdout, stderr){
      reponse = checkDSSreponse(error, stdout, stderr,
                                'validateApplicationToken', str);
      //on a bien recu le token
      console.log('Token valide avec succes')
      main(numEtape+1);
    }
  );
}

/*
 * tente de se connecter au DSS avec l'applicationToken
 */
function connexionDSS(numEtape){
  process.stdout.write('authentification aupres du DSS ... ');
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/'
          + 'loginApplication?loginToken=' + config.applicationToken;
  var child = exec(str,
    function(error, stdout, stderr){
      var reponse = checkDSSreponse(error,stdout,stderr,'connexionDSS',str);
      //on a bien recu le sessionToken
      console.log('OK');
      config.DSS.sessionToken = reponse.result.token;
      main(numEtape+10);
    }
  );
}

/*
 * fait les verifications d'usage sur la reponse fournie par le dss.
 */
function checkDSSreponse(error,stdout,stderr,funcName,cmd){
  var reponse;
  if (error !== null || stderr !=='' || stdout ==''){
    errorExit('ERR (' + funcName + ') la reponse obtenue contient une '
              + 'erreur. cmd:'+cmd+'\nerror:',
              error);
  }
  try{
    reponse = JSON.parse(stdout);
  } catch(err) {
    errorExit("ERR (" + funcName + ") : erreur lors du parsage de " +
              "stdout de la commande \"" + cmd + "\"\nerror:" +
              err + '\nstdout:' + stdout);
  }
  if (reponse == undefined ||
      reponse.ok == undefined) {
    errorExit('ERR (' + funcName + ') le serveur DSS n\''
              + 'a pas renvoye une reponse correcte\n', reponse);
  }
  if (reponse.ok == false){
    if (reponse.message=='Application-Authentication failed') {
    errorExit("\nerreur lors de l'authentification,\nle DSS refuse le" +
                " token du serveur");
    }
    errorExit('ERR ('+ funcName + ') : la reponse renvoyee par le DSS ' +
              'indique ok:false\ncmd: '+cmd+'\n', reponse);
  }
  return reponse;
}

/**
 * configure et lance le serveur nodeJS.
 */
function lancementServeur() {
  console.log('+----------------------+')
  console.log('| lancement du serveur |');
  console.log('+----------------------+')
  app.configure(function(){
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.set('env','development');
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser('your secret here'));
    app.use(express.session());
    app.use(app.router);
    app.use(require('stylus').middleware(__dirname + '/public'));
    app.use(express.static(path.join(__dirname, 'public')));
  });
  
  app.configure('development', function(){
    app.use(express.errorHandler());
    app.locals.pretty = true;
  });
  
  app.get('/', routes.index);
  app.get('/users', user.list);
  app.get('/clock', routes.clock);
  
  http.createServer(app).listen(app.get('port'), function(){
    console.log("Express server listening on port " + app.get('port'));
    startRoutine();
  });
};

/*
 * definit les fonctions qui serons appelees regulierement
 */
function startRoutine() {
  setInterval( function(){
      getLatestValuesOfDSmInBDD([mapGetValues]);
    }, config.refreshTime);
  setInterval( function(){
      cleanOldValuesOfDeprecatedDSm();
    }, config.refreshTime*5);
}

/*
 * compare l'horloge du DSS et du serveur Node
 * stock l'ecart de temps dans config.DSS.timeDiff
 */
function compareTimeNodeDSS(callback) {
  process.stdout.write('comparaison des horloges NodeJS - DSS ... ');
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'system/time';
  var child = exec(str,
    function(error, stdout, stderr){
      var time = parseInt(new Date().getTime()/1000);
      var reponse = checkDSSreponse(error, stdout, stderr,
                                    'compareTimeNodeDSS', str);
      config.DSS.timeDiff = reponse.result.time - time;
      if (config.DSS.timeDiff > 20  ||  config.DSS.timeDiff < -20) {
        errorExit('la difference d\'horloge entre le DSS et le serveur Node ' +
                  'est trop importante, merci de les regler a la meme heure');
      }
      console.log('OK   ecart de temps:' + config.DSS.timeDiff + 's');
      var c = reduceCallback(callback);
      if (c!==undefined){
        c[0](c[1]);
      }
    }
  );  
}

/*
 * decompose un callback (c) pour renvoyer un tableau contenant dans la
 * premiere case la fonction suivante, et en deuxieme case le reste des
 * fonctions.
 */
function reduceCallback(c){
  if (c == undefined){;return}
  if (typeof c === 'function') {return [c,[]];}
  if (Array.isArray(c) && c.length>0){
    var f = c[0];
    c.shift();
    return [f,c]
  }
}

/*
 * appelle la prochaine fonction du tableau c
 */
function nextCallback(c){
  if (c == undefined){return;}
  if (typeof c === 'function') {c();return;}
  if (Array.isArray(c) && c.length>0){
    var f = c.shift();
    f(c);
    return;
  }
}

/*
 * recupere la liste des DSMeters aupres du DSS
 * et les stocke dans l'objet config.DSS.meters
 */
function getDSSMeters(callback){
  process.stdout.write('recuperation des DS Meters ... ');
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'apartment/'
          + 'getCircuits?token='+config.DSS.sessionToken;
  var child = exec(str,
    function(error, stdout, stderr){
      var reponse = checkDSSreponse(error, stdout, stderr,
                                    'getDSSMeters', str);
      var c = reponse.result.circuits;
      config.DSS.meters = {};
      for(var i=0;i<c.length;i++) {
          config.DSS.meters[c[i].dsid]=c[i];
      }
      console.log('OK');
      var c = reduceCallback(callback);
      if (c!==undefined){
        c[0](c[1]);
      }
    }
  );  
}

/*
 * recupere la liste des series de mesuresdisponnibles
 * aupres du DSS et les stocke dans l'objet config.DSS.series
 */
function getDSSSeries(callback){
  process.stdout.write('recuperation des series de mesures ... ');
  var str = 'curl -s --insecure ' + config.DSS.jsonURL + 'metering/'
          + 'getSeries?token='+config.DSS.sessionToken;
  var child = exec(str,
    function(error, stdout, stderr){
      var reponse = checkDSSreponse(error, stdout, stderr,
                                    'getDSSSeries', str);
      var s = reponse.result.series;
      config.DSS.series = {};
      for(var i=0;i<s.length;i++) {
        if (config.DSS.series[s[i].dsid] == undefined){
          config.DSS.series[s[i].dsid] = {};
        }
        config.DSS.series[s[i].dsid][s[i].type] = true;
      }
      console.log('OK');
      var c = reduceCallback(callback);
      if (c!==undefined){
        c[0](c[1]);
      }
    }
  );  
}

/*
 * demande la liste des meters stockes dans la BDD avec
 * leur derniere mesure de consommation
 * les stocke dans config.couchdb.meters {DSID:{}, DSID:{}, ... }
 * !attention! : efface le champ config.couchdb.meters lors de l'execution
 */
function getLatestValuesOfDSmInBDD(callback){
  bdd.view('getConsumption','latest', function(err,body){
      if(!err){
        var meters = {};
        for (var i=0;i<body.rows.length;i++){
          var clef = body.rows[i].key.replace('dsm_','');
          meters[clef] = {};
          meters[clef].BDDid = body.rows[i].key;
          meters[clef].latestValue = body.rows[i].value;
        }
        config.couchdb.meters = meters;
      } else {
        errorExit('(getLatestValuesOfDSmInBDD): la vue getComsumption a ' +
                  'retournee une erreur\n', err)
      }
      nextCallback(callback);
    }
  );
}

/* 
 * dispatche la demande des series de valeurs suivant les series disponnibles
 */
function mapGetValues(callback){
  var timeDSS = parseInt(new Date().getTime() / 1000) + config.DSS.timeDiff;;
  for (var i in config.DSS.series) {//pour tous les DSm
    //si la mesure de consommation est possible
    if (config.DSS.series[i].consumption == true){
      //si des anciennes donnees sur ce meter exitent
      if (config.couchdb.meters[i] !== undefined) {
        if (config.couchdb.meters[i].latestValue !== undefined &&
            config.couchdb.meters[i].latestValue !== null){//pas de valeur
          var latest = config.couchdb.meters[i].latestValue;
          var timeDiff = timeDSS - latest;
          if (timeDiff < 599) {//si les mesures sont continues
            getValuesFromDSS(i, latest);
          }else {
            removeOldValues(i);
          }
        }else{//pas de valeur
          getValuesFromDSS(i,true);
        }
      }else{//pas de document
        getValuesFromDSS(i,false);
      }
    }
  }
}

function removeOldValues(DSid){
  //on recupere le document avec l'id 'dsm_DSid'
  bdd.get(config.couchdb.meters[DSid].BDDid,function(e, b, h){
      if(e || b==undefined){
        errorExit('(removeOldValues) erreur d\'acces au document "' +
                  config.couchdb.meters[DSid].BDDid + '"', e);
      }
      var doc = cleanOldValues(b);
      //insertion dans la bdd
      //on reinsere le document dans la BDD
      bdd.insert(doc,function(e, b, h){
          if(e || b==undefined || b.ok==undefined || b.ok==false){
            console.error('(removeOldValues) le nouveau document n\'a pas ' +
                      ' reussi a etre insere dans la bdd', e);
          }
          //le nouveau document a ete enregistre dans la BDD
        }
      );
    }
  );
}

/*
 * fait l'acquisition des nouvelles valeurs de consommation
 * et appelle la fonction storeValuesInBDD pour les stocker
 * param: DSid  le dsid du meter duquel on veut connaitre la consommation
 *        latestValue  (int) la derniere valeur stockee en BDD
 *                     (true) aucune valeur en bdd dans le document
 *                     (false) aucun document en bdd, il sera cree
 */
function getValuesFromDSS(DSid, latestValue){
  var cmd = 'curl -s --insecure ' + config.DSS.jsonURL + 'metering/' +
            'getValues?dsid=' + DSid +'\\&type=consumption\\&resolution=1'+
            '\\&token=' + config.DSS.sessionToken;
  if (typeof(latestValue) == 'number'){
    cmd = cmd + '\\&startTime=' + latestValue;
  }
  var child = exec(cmd,
    function(error, stdout, stderr){
      var reponse = checkDSSreponse(error,stdout,stderr,'getValuesFromDSS',cmd);
      if (reponse.result !== undefined && reponse.result.resolution == '1'){
        storeValuesInBDD1(DSid, reponse.result.values, latestValue);
      }else{
        errorExit('(getValuesFromDSS): le resultat est incorrect ou la ' +
                  'resolution est differente de 1\nreponse recue:',reponse);
      }
    }
  );
}

/* 
 * demande a la BDD le document correspondant au dss si necessaire (ou le creer)
 * puis transmet le document a la fonction storeValuesInBDD2 pour completer
 * le document et le stocker
 * param:  DSid  DSid du meter
 *         values  le tableau contenant les valeurs de consommation a stocker
 *         latestValue  (int) la derniere valeur stockee en BDD
 *                      (true) aucune valeur en bdd dans le document
 *                      (false) aucun document en bdd, il sera cree
 */
function storeValuesInBDD1(DSid, values, latestValue){
  var doc;
  if (latestValue == false){
    doc = {"_id":"dsm_"+DSid, type:'dsm', consumptionValues1s:[]};
    storeValuesInBDD2(doc, values);
  }else{
    bdd.get('dsm_'+DSid,function(e, b, h){
        if(e || b==undefined){
          errorExit('(storeValuesInBDD1) erreur d\'acces au document ' +
                    'dsm_'+DSid, e);
        }
        if(latestValue == true){
          b.consumptionValues1s = [];
        }
        storeValuesInBDD2(b, values);
      }
    );
  }
}

/*
 * supprime les anciennes valeurs du document puis
 * le complete avec les nouvelles valeurs puis le stocke en BDD
 * param: doc    le document a modifier
 *        values le tableau des nouvelles valeurs
 */
function storeValuesInBDD2(doc, values){
  doc = cleanOldValues(doc);
  for( var i=0; i<values.length; i++){
    doc.consumptionValues1s.push({t:values[i][0], c:values[i][1]});
  }
  bdd.insert(doc,function(e, b, h){
      if(e || b==undefined || b.ok==undefined || b.ok==false){
        console.error('(storeValuesInBDD2) le document n\'a pas reussi a etre' +
                  ' insere dans la bdd', e);
      }
    }
  );
}

/*
 * enleve les valeurs trop anciennes du document
 */
function cleanOldValues(doc){
  var newtab = []
  var deadline = parseInt(new Date().getTime()/1000)
                 + config.DSS.timeDiff
                 - 599;
  //creation du nouveau tableau, on garde seulement les valeurs recentes
  if (doc.consumptionValues1s !== undefined) {
    for (var i=0; i<doc.consumptionValues1s.length; i++){
      if (doc.consumptionValues1s[i].t > deadline){//assez recente
        newtab.push(doc.consumptionValues1s[i]);
      }
    }
    //modification du document
    doc.consumptionValues1s = newtab;
  }
  return doc;
}

/*
 * supprime les valeur de consommation trop vieilles
 * des DSm non mesurables
 */
function cleanOldValuesOfDeprecatedDSm(){
  if(config.couchdb.meters !== undefined && config.DSS.series !== undefined){
    for (var i in config.couchdb.meters){
      if (config.couchdb.meters[i].latestValue !== null &&
          config.DSS.series[i] == undefined){
        console.log('test, ' + config.couchdb.meters[i].BDDid);
        removeOldValues(i);
      }
    }
  }
  compactBDD();
}

/*
 * compacte la base de donnee
 */
function compactBDD(){
  bdd.compact();
  bdd.view.compact('getConsumption');
//console.log('compactage :\n',e);console.log(b);console.log(h);});
}
