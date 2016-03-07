'use strict';

var path = require('path');
var express = require('express');
var app = express();
var expressLess = require('express-less');
var config = require('../config').config;
var cookieParser = require('cookie-parser');
var session = require('express-session');
var NedbStore = require('connect-nedb-session')(session);
var passport = require('passport');
var SteamStrategy = require('passport-steam').Strategy;
var TwitchStrategy = require('passport-twitch').Strategy;
var BeamStrategy = require('passport-beam').Strategy;
var log = require('../logger')('nodecg/lib/login');

// Passport setup.
// Serializing full user profile, setting up SteamStrategy.
passport.serializeUser(function (user, done) {
	done(null, user);
});
passport.deserializeUser(function (obj, done) {
	done(null, obj);
});

if (config.login.steam && config.login.steam.enabled) {
	passport.use(new SteamStrategy({
		returnURL: 'http://' + config.baseURL + '/login/auth/steam',
		realm: 'http://' + config.baseURL + '/login/auth/steam',
		apiKey: config.login.steam.apiKey
	}, function (identifier, profile, done) {
		process.nextTick(function () {
			profile.allowed = (config.login.steam.allowedIds.indexOf(profile.id) > -1);

			if (profile.allowed) {
				log.info('Granting %s (%s) access', profile.id, profile.displayName);
			} else {
				log.info('Denying %s (%s) access', profile.id, profile.displayName);
			}

			return done(null, profile);
		});
	}));
}

if (config.login.twitch && config.login.twitch.enabled) {
	// The "user_read" scope is required. Add it if not present.
	var scope = config.login.twitch.scope.split(' ');
	if (scope.indexOf('user_read') < 0) {
		scope.push('user_read');
	}
	scope = scope.join(' ');

	passport.use(new TwitchStrategy({
		clientID: config.login.twitch.clientID,
		clientSecret: config.login.twitch.clientSecret,
		callbackURL: (config.ssl && config.ssl.enabled ? 'https://' : 'http://') +
			config.baseURL + '/login/auth/twitch',
		scope: scope
	}, function (accessToken, refreshToken, profile, done) {
		process.nextTick(function () {
			profile.allowed = (config.login.twitch.allowedUsernames.indexOf(profile.username) > -1);

			if (profile.allowed) {
				log.info('Granting %s access', profile.username);
				profile.accessToken = accessToken;
				// Twitch oauth does not use refreshToken
			} else {
				log.info('Denying %s access', profile.username);
			}

			return done(null, profile);
		});
	}));
}

if (config.login.beam && config.login.beam.enabled) {
	var beamScope = config.login.beam.scope.split(' ');
	if (beamScope.indexOf('user:details:self') < 0) {
		beamScope.push('user:details:self');
	}
	beamScope = beamScope.join(' ');
	passport.use(new BeamStrategy({
		clientID: config.login.beam.clientID,
		clientSecret: config.login.beam.clientSecret,
		callbackURL: (config.ssl && config.ssl.enabled ? 'https://' : 'http://') +
			config.baseURL + '/login/auth/beam',
		scope: beamScope
	},
	function (accessToken, refreshToken, profile, done) {
		process.nextTick(function () {
			var username = profile.username;
			profile.allowed = (config.login.beam.allowedUsernames.indexOf(username) > -1);
			if (profile.allowed) {
				log.info('Granting %s access', username);
				profile.accessToken = accessToken;
				profile.refreshToken = refreshToken;
			} else {
				log.info('Denying %s access', username);
			}
			return done(null, profile);
		});
	}));
}

app.use(cookieParser());
app.use(session({
	secret: config.login.sessionSecret,
	resave: true,
	saveUninitialized: true,
	store: new NedbStore({filename: path.resolve(__dirname, '../../db/sessions.db')})
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/login', express.static(path.join(__dirname, 'public')));
app.use('/login', expressLess(path.join(__dirname, 'public'), {compress: true}));
app.set('views', __dirname);

app.get('/login', function (req, res) {
	res.render('public/login.jade', {user: req.user, config: config});
});

app.get('/authError', function (req, res) {
	res.render('public/authError.jade', {
		message: req.query.message,
		code: req.query.code,
		viewUrl: req.query.viewUrl
	});
});

app.get('/login/steam',
	passport.authenticate('steam'),
	function () {
		// Passport will redirect to Steam to login
	}
);

app.get('/login/auth/steam',
	passport.authenticate('steam', {failureRedirect: '/login'}),
	redirectPostLogin
);

app.get('/login/twitch',
	passport.authenticate('twitch'),
	function () {
		// Passport will redirect to Twitch to login
	}
);

app.get('/login/auth/twitch',
	passport.authenticate('twitch', {failureRedirect: '/login'}),
	redirectPostLogin
);

app.get('/login/auth/beam',
	passport.authenticate('beam', {failureRedirect: '/login'}),
	redirectPostLogin
);

app.get('/login/beam',
	passport.authenticate('beam'),
	function () {

	}
);

app.get('/logout', function (req, res) {
	app.emit('logout', req.session);
	req.session.destroy(function () {
		res.clearCookie('connect.sid');
		res.clearCookie('socketToken');
		res.redirect('/');
	});
});

function redirectPostLogin(req, res) {
	var url = req.session.returnTo || '/dashboard';
	res.redirect(url);
	app.emit('login', req.session);
}

module.exports = app;
