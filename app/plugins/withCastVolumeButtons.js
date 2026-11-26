// The iPhone's volume buttons change the Chromecast's volume by default (Cast SDK option
// physicalVolumeButtonsWillControlDeviceVolume). StremCastio has its own volume control on screen,
// so the buttons keep controlling the phone only.
//
// Must be listed BEFORE "react-native-google-cast" in app.json: plugins listed later run their
// AppDelegate changes first, and this one edits the Cast setup that plugin inserts.
const { withAppDelegate } = require('@expo/config-plugins')

const LINE = 'physicalVolumeButtonsWillControlDeviceVolume = false'

module.exports = function withCastVolumeButtons(config) {
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents
    if (!src.includes(LINE)) {
      const swift = /^(\s*)GCKCastContext\.setSharedInstanceWith\(options\)/m
      const objc = /^(\s*)\[GCKCastContext setSharedInstanceWithOptions:options\];/m
      if (swift.test(src)) src = src.replace(swift, (m, indent) => `${indent}options.${LINE}\n${m}`)
      else if (objc.test(src)) src = src.replace(objc, (m, indent) => `${indent}options.${LINE};\n${m}`)
      else throw new Error('withCastVolumeButtons: Google Cast setup not found in AppDelegate (plugin order?)')
    }
    cfg.modResults.contents = src
    return cfg
  })
}
