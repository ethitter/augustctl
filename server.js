'use strict';

/**
 * LIBRARIES
 */

var augustctl = require( './index' );
var express   = require( 'express' );
var morgan    = require( 'morgan' );
var await     = require( 'asyncawait/await' );
var async     = require( 'asyncawait/async' );
var apicache  = require( 'apicache' ).options( { defaultDuration: 15000 } );
var cache     = apicache.middleware;

var config       = require( process.env.AUGUSTCTL_CONFIG || './config.json' );
var serverConfig = require( process.env.AUGUSTCTL_SERVER_CONFIG || './server-config.json' );

var DEBUG   = process.env.NODE_ENV !== 'production';
var address = serverConfig.address || 'localhost';
var port    = serverConfig.port || 3000;

var app = express();
app.use( morgan( DEBUG ? 'dev' : 'combined' ) );

/**
 * UTILITIES
 */

// Default return arguments
var ret = {
    'status': -1,
    'ret':    '',
    'msg':    ''
};

// Register a given lock if it can be located
function registerLock( lockName, lockConfig ) {
    augustctl.scan( lockConfig.lockUuid ).then( function( peripheral ) {
        var lock = new augustctl.Lock(
            peripheral,
            lockConfig.offlineKey,
            lockConfig.offlineKeyOffset
        );

        app.set('lock' + lockName, lock);
    } );
}

// Get lock instance
function getLockInstance( lockName, res ) {
    var lock = app.get( 'lock' + lockName );
    if ( lock ) {
        return lock;
    } else {
        if ( 'object' === typeof config[ lockName ] ) {
            console.log( 'Loading MISSING config for lock "%s" (%s)', lockName, config[ lockName ].lockUuid );
            registerLock( lockName, config[ lockName ] );
        }

        clearCaches( lockName );
        res.sendStatus( 400 );
        return false;
    }
}

// Convert named status to integer representation
function statusStringtoInt( status ) {
    var statusInt = -1;

    if ( 'locked' === status ) {
        statusInt = 0;
    } else if ( 'unlocked' === status ) {
        statusInt = 1;
    }

    return statusInt;
}

// Clear cached routes
function clearCaches( lockName ) {
    apicache.clear( '/api/status/' + lockName );
    apicache.clear( '/api/lock/' + lockName );
    apicache.clear( '/api/unlock/' + lockName );

    return true;
}

/**
 * ROUTES
 */

// Endpoint to check lock status
app.get( '/api/status/:lock_name', cache( '5 seconds' ), function( req, res ) {
    // Parse allowed request arguments
    var lock = getLockInstance( req.params.lock_name, res );
    if ( ! lock ) {
        return;
    }

    // Suspendable functions to check lock's status
    var actionFunction = async( function() {
        var status = await( lock.status() );

        ret.ret    = status;
        ret.status = statusStringtoInt( status );
        ret.msg    = "Status checked successfully.";

        lock.disconnect();
        res.json( ret );
    } );

    // Perform requested action
    lock.connect().then( actionFunction ).catch( function( err ) {
        console.error( err );
        res.sendStatus( 503 );
    } );
} );

// Endpoint to change lock state
app.get( '/api/:lock_action(lock|unlock)/:lock_name', cache( '3 seconds' ), function( req, res ) {
    // Parse allowed request arguments
    var action = req.params.lock_action,
        allowedActions = [ 'unlock', 'lock' ];
    if ( -1 === allowedActions.indexOf( action ) ) {
        res.sendStatus( 400 );
        return;
    }

    var lockName = req.params.lock_name,
        lock = getLockInstance( lockName, res );
    if ( ! lock ) {
        return;
    }

    // Suspendable functions to interact with lock based on requested action
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
            ret.ret    = status;
            ret.status = statusStringtoInt( status );
            ret.msg    = "No change made. Lock was already '" + status + "'.";
        }

        lock.disconnect();
        clearCaches( lockName );
        res.json( ret );
    } );

    // Perform requested action
    lock.connect().then( actionFunction ).catch( function( err ) {
        console.error( err );
        res.sendStatus( 503 );
    } );
} );

// Endpoint to disconnect a lock's BLE connections
app.get( '/api/disconnect/:lock_name', function( req, res ) {
    // Parse allowed request arguments
    var lock = getLockInstance( req.params.lock_name, res );
    if ( ! lock ) {
        return;
    }

    lock.disconnect();
    clearCaches( req.params.lock_name );
    res.sendStatus( 204 );
} );

/**
 * SERVER SETUP
 */

// Parse lock configurations
Object.keys( config ).forEach( function( lockName ) {
    var lockConfig = config[ lockName ];

    console.log( 'Loading config for lock "%s" (%s)', lockName, lockConfig.lockUuid );

    registerLock( lockName, lockConfig );
} );

// Start Express server
var server = app.listen( port, address, function() {
    console.log( 'Listening at %j', server.address() );
} );
