'use strict';

var augustctl = require( './index' );
var express   = require( 'express' );
var morgan    = require( 'morgan' );
var await     = require( 'asyncawait/await' );
var async     = require( 'asyncawait/async' );

var config       = require( process.env.AUGUSTCTL_CONFIG || './config.json' );
var serverConfig = require( process.env.AUGUSTCTL_SERVER_CONFIG || './server-config.json' );

var DEBUG   = process.env.NODE_ENV !== 'production';
var address = serverConfig.address || 'localhost';
var port    = serverConfig.port || 3000;

var app = express();
app.use( morgan( DEBUG ? 'dev' : 'combined' ) );

// Default return arguments
var ret = {
    'status': -1,
    'ret':    '',
    'msg':    ''
};

// Endpoint to perform all lock actions
app.get( '/api/:lock_action/:lock_name', function( req, res ) {
    // Parse allowed request arguments
    var action = req.params.lock_action,
        allowedActions = [ 'unlock', 'lock', 'status' ];
    if ( -1 === allowedActions.indexOf( action ) ) {
        res.sendStatus( 400 );
        return;
    }

    var lock = app.get( 'lock' + req.params.lock_name );
    if ( ! lock ) {
        res.sendStatus( 400 );
        return;
    }

    // Suspendable functions to interact with lock based on requested action
    if ( 'status' === action ) {
        // Checks lock's state and returns it
        var actionFunction = async( function() {
            var status    = await( lock.status() ),
                statusInt = -1;

            if ( 'locked' === status ) {
                statusInt = 0;
            } else if ( 'unlocked' === status ) {
                statusInt = 1;
            }

            ret.ret    = status;
            ret.status = statusInt;
            ret.msg    = "Status checked successfully.";

            lock.disconnect();
            res.json( ret );
        } );
    } else {
        // Locks or unlocks a requested lock, if not already in that state
        var actionFunction = async( function() {
            var status = await( lock.status() );

            if ( 'lock' === action && 'unlocked' === status ) {
                var cmd = await( lock.forceLock() );

                ret.ret    = 'locked';
                ret.status = 0;
                ret.msg    = 'Locked as requested.';
            } else if ( 'unlock' === action && 'locked' === status ) {
                var cmd = await( lock.forceUnlock() );

                ret.ret    = 'unlocked';
                ret.status = 1;
                ret.msg    = 'Unlocked as requested.';
            } else {
                var statusInt = -1;

                if ( 'locked' === status ) {
                    statusInt = 0;
                } else if ( 'unlocked' === status ) {
                    statusInt = 1;
                }

                ret.ret    = status;
                ret.status = statusInt;
                ret.msg    = "No change made. Lock was already '" + status + "'.";
            }

            lock.disconnect();
            res.json( ret );
        } );
    }

    // Perform requested action
    lock.connect().then( actionFunction ).catch( function( err ) {
        console.error( err );
        lock.disconnect();
        res.sendStatus( 500 );
    } );
} );

// Parse lock configurations
Object.keys( config ).forEach( function( lockName ) {
    var lockConfig = config[ lockName ];

    augustctl.scan( lockConfig.lockUuid ).then( function( peripheral ) {
        var lock = new augustctl.Lock(
            peripheral,
            lockConfig.offlineKey,
            lockConfig.offlineKeyOffset
        );

        app.set('lock' + lockName, lock);
    } );
} );

// Start Express server
var server = app.listen( port, address, function() {
    console.log( 'Listening at %j', server.address() );
} );
