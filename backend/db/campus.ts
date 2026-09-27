type LatLng = { lat: number; lng: number };
type Entrance = { id: string; buildingId: string; label: string; location: LatLng; accessible: boolean; rooms: string[] };
type Building = { id: string; code: string; name: string; location: LatLng; entrances: Entrance[] };

// FIU Modesto A. Maidique Campus (MMC).
//
// Only buildings and their DOORS live here. Curb zones are generated
// by db/generate-curbs.ts using the server Google key.
//
// Coordinates are APPROXIMATE. Fix each door by finding it on satellite view /
// Street View. The seed preserves existing records so verified edits are retained.

export const CAMPUS_CENTER: LatLng = { lat: 25.7568, lng: -80.3743 }

/** Where the car starts when we don't have your GPS: main entrance off SW 8th St. */
export const CAMPUS_GATE: LatLng = { lat: 25.7619, lng: -80.3706 }

/** Where walk mode starts when you're not on campus (demo): PG5 Market Station garage. */
export const WALK_DEMO_START = { location: { lat: 25.7604, lng: -80.3722 } as LatLng, label: 'PG5 Market Station garage' }

type DoorSeed = [id: string, label: string, location: LatLng, accessible: boolean, rooms?: string[]]

const building = (id: string, code: string, name: string, location: LatLng, doors: DoorSeed[]): Building => ({
  id,
  code,
  name,
  location,
  entrances: doors.map(
    ([eid, label, loc, accessible, rooms]): Entrance => ({ id: eid, buildingId: id, label, location: loc, accessible, rooms: rooms ?? [] }),
  ),
})

export const BUILDINGS: Building[] = [
  building('gc', 'GC', 'Graham Center', { lat: 25.75625, lng: -80.37318 }, [
    ['gc-east', 'East entrance (ballrooms)', { lat: 25.75624, lng: -80.37275 }, true, ['1xx', '2xx']],
    ['gc-south', 'South doors (food court)', { lat: 25.75592, lng: -80.3732 }, true, ['1xx']],
    ['gc-north', 'North stairs (2nd–3rd floor)', { lat: 25.75658, lng: -80.37328 }, false, ['2xx', '3xx']],
  ]),
  building('gl', 'GL', 'Green Library', { lat: 25.75735, lng: -80.37375 }, [
    ['gl-east', 'Main entrance (east)', { lat: 25.75737, lng: -80.37338 }, true],
    ['gl-north', 'North doors (stairs)', { lat: 25.75772, lng: -80.37378 }, false, ['3xx', '4xx', '5xx', '6xx', '7xx', '8xx']],
  ]),
  building('pc', 'PC', 'Primera Casa', { lat: 25.7553, lng: -80.3731 }, [
    ['pc-east', 'East entrance', { lat: 25.7553, lng: -80.37278 }, true],
    ['pc-south', 'South doors (stairs)', { lat: 25.75502, lng: -80.3731 }, false, ['3xx', '4xx', '5xx']],
  ]),
  building('dm', 'DM', 'Deuxième Maison', { lat: 25.7562, lng: -80.3755 }, [
    ['dm-west', 'West entrance', { lat: 25.7562, lng: -80.3759 }, true],
  ]),
  building('rb', 'RB', 'Ryder Business Building', { lat: 25.75955, lng: -80.37335 }, [
    ['rb-north', 'North lobby', { lat: 25.75982, lng: -80.37333 }, true],
  ]),
  building('obc', 'OBC', 'Ocean Bank Convocation Center', { lat: 25.7585, lng: -80.3789 }, [
    ['obc-east', 'East plaza gates', { lat: 25.7585, lng: -80.3785 }, true],
  ]),
]

