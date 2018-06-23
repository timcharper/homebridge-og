const request = require("request-promise-native")

function OpenGarageModule(log, config, {Service, Characteristic, openGarageApi, setTimeout, clearTimeout, Date}) {
    let openDurationMs = config.openDurationMs || OpenGarageModule.defaults.openDurationMs
    let pollFrequencyMs = config.pollFrequencyMs || OpenGarageModule.defaults.pollFrequencyMs
    function after(ms, result) {
        return new Promise((success, reject) => {
            setTimeout(() => success(result), ms)
        })
    }
    function syncGetter(fn) {
        return (next) => {
            try {
                next(null, fn())
            }
            catch (error) {
                log("error ", error)
                next(error)
            }
        }
    }

    class OpenGarage {
        constructor(name, isClosed) {
            this.name = name
            // TODO - we should probably default to undefined, and return an error if we haven't heard from the state.
            this.isClosed = isClosed
            this.lastTarget = {ts: 0, closed: isClosed}

            this.garageService = new Service.GarageDoorOpener( this.name );

            this.garageService
                .getCharacteristic( Characteristic.CurrentDoorState )
                .on( "get", this.getState.bind( this ) );

            this.garageService
                .getCharacteristic( Characteristic.TargetDoorState )
                .on( "get", syncGetter(this.targetDoorState.bind( this ) ))
                .on( "set", this.changeState.bind( this ) );

            this.garageService
		            .getCharacteristic( Characteristic.ObstructionDetected )
		            .on( "get", this.getStateObstruction.bind( this ) );
            this.notify()
            this.pollStateRefreshLoop()
        }

        getStateObstruction ( callback ) {
            callback( null, false );
        };

        getState ( callback ) {
            callback(null, this.currentDoorState())
            log( "Getting current state..." );
            this.triggerStateRefresh().then((isClosed) => {
                log( "Status garage: %s", isClosed ? "closed" : "open" );
            })
        }

        targetDoorState () {
            if ((Date.now() - this.lastTarget.ts) >= openDurationMs) { // past time expected to open
                if (this.isClosed)
                    return Characteristic.TargetDoorState.CLOSED
                else
                    return Characteristic.TargetDoorState.OPEN
            } else {
                if (this.lastTarget.closed)
                    return Characteristic.TargetDoorState.CLOSED
                else
                    return Characteristic.TargetDoorState.OPEN
            }
        }

        currentDoorState() {
            // If we haven't heard for the last couple of polls durations, we should return an error
            if (this.isClosed)
                return Characteristic.CurrentDoorState.CLOSED
            else
                return Characteristic.CurrentDoorState.OPEN
        }

        triggerStateRefresh() {
            return openGarageApi.getState().then((state) => {
                this.isClosed = state.door === 0
                this.notify()
                log.debug( "Poll status garage: %s", this.isClosed ? "closed" : "open" );
                return this.isClosed
            })
        }


        pollStateRefreshLoop() {
            // reset poll timer if already set
            if (this.pollTimer) clearTimeout(this.pollTimer)
            this.pollTimer = setTimeout(() => this.pollStateRefreshLoop(), pollFrequencyMs)

            this.triggerStateRefresh().catch((err) => {
                log("Error polling state", err)
            })
        }

        notify() {
            this.garageService.getCharacteristic(Characteristic.CurrentDoorState)
                .updateValue(this.currentDoorState())
            this.garageService.getCharacteristic(Characteristic.TargetDoorState)
                .updateValue(this.targetDoorState())
        }

        changeState ( state, callback ) {
            let targetStateClosed = state === Characteristic.TargetDoorState.CLOSED
            log( "Set state to %s", targetStateClosed ? "closed" : "open" );

            openGarageApi.setTargetState(targetStateClosed)
                .then(
                    (_) => {
                        log("Target state successfully received.")
                        this.lastTarget = {
                            ts: Date.now(),
                            closed: targetStateClosed
                        }
                        callback(null)
                        return(after(openDurationMs, true))
                    },
                    (err) => {
                        callback(err)
                        throw(err)
                    })
                .then((_) => this.triggerStateRefresh())
                .catch((err) => {
                    log("Error changing state", err)
                })
        }
    }

    return OpenGarage
}
OpenGarageModule.defaults = {
    openDurationMs: 25000,
    pollFrequencyMs: 60000
}
module.exports = OpenGarageModule