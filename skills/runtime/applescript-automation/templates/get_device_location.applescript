-- Get Device Location via CoreLocation
-- Returns latitude,longitude in decimal degrees format
-- Requires Location Services enabled in System Preferences > Privacy & Security

-- Timeout after 5 seconds if location unavailable
property timeoutSeconds : 5

-- Swift script for CoreLocation access
property swiftScript : "
import CoreLocation
import Foundation

class LocationManager: NSObject, CLLocationManagerDelegate {
    let manager = CLLocationManager()
    let semaphore = DispatchSemaphore(value: 0)
    var location: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        location = locations.last
        semaphore.signal()
    }

    func wait(timeout: Int) -> CLLocation? {
        _ = semaphore.wait(timeout: .now() + .seconds(timeout))
        return location
    }
}

let lm = LocationManager()
if let loc = lm.wait(timeout: " & timeoutSeconds & ") {
    print(\"\(loc.coordinate.latitude),\(loc.coordinate.longitude)\")
    exit(0)
} else {
    print(\"Location unavailable\")
    exit(1)
}
"

-- Execute Swift script to get location
try
    set locationResult to (do shell script "swift -e '" & swiftScript & "'")
    if locationResult contains "," then
        return locationResult
    else
        return error "Location services unavailable"
    end if
on error errMsg
    -- Fallback to IP-based geolocation
    try
        set ipLocation to (do shell script "curl -s 'https://ipapi.co/json' | jq -r '.latitude,.longitude' | paste -sd ',' -")
        return ipLocation
    on error
        return error "Unable to determine location"
    end try
end try
