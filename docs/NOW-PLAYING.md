# Now Playing, requests and lyrics

What was added on top of the free personal radio, and how each part works.

## Design

Midnight-blue Liquid Glass: a deep navy base, blue ambient light, frosted panels with a glossy top edge, and a soft glow taken
from the current cover's colours. Motion is spring-based ([Motion for React](https://motion.dev), the one animation library
added), animates only transform/opacity/filter, pauses with the music, and is switched off when the phone asks for reduced motion.
The system font (San Francisco on iPhone) is used first.

Libraries considered and not added: Embla Carousel and cover-flow components (a carousel would mean a second list of songs
that can drift from what is really playing; the cover stage here is driven by the player itself), Liquid Glass React packages
(they rely on SVG displacement filters that are expensive on iPhone; plain CSS glass is used instead), and LRC packages (the
parser is about 40 lines and handles enhanced word timestamps without guessing).

## Now Playing

- **Cover art:** Spotify songs use their album art. YouTube songs get the real album cover from the iTunes Search API (free,
  no key) through `/api/art`, which cleans titles like "Artist - Song (Official Video)" first and only accepts a confident
  match. Otherwise the video thumbnail is used, and if an image fails to load a generated cover (gradient + initials) replaces it.
- **Ambient glow:** the cover's main colour is read from a 16×16 copy of the image. Hosts that don't allow that (no CORS)
  fall back to the default blue.
- **Transitions:** each song gets its own cover layer. The outgoing cover slides away with depth while the incoming one scales
  into place (spring, perspective, crossfade, blur); title and artist move with it. The stage is keyed by the song actually
  loaded in the player, so the cover can't show one song while another plays.
- **Gestures:** swipe left on the cover for the next song, right for the previous one (then the song you left plays again).
  Tap the cover to pause. Vertical swipes scroll the page as normal.
- **Controls:** previous, play/pause, next; a volume slider on computers where the app controls the volume (iPhone volume is
  the hardware buttons: Safari doesn't let pages change it); lyrics; and a dock for Request, Library, Station, Host and Stop.
- **YouTube's rule:** the YouTube player must stay visible at 200×200 or more while it plays. It sits beside the title as a
  "video window"; the cover stays the centrepiece. On short screens (under 760px tall) the cover hides in YouTube mode so
  the video window still fits.
- **Compact player:** every sheet (Request, Library, Station, Your RJ) shows a mini player at the bottom; the full player
  shrinks back behind it and keeps playing. Nothing navigates away from the live page while the show is on.

## Requests and tags

- Open **Request** and type a song ("play Bendiciones by Jhexx"), an artist, or a feeling ("feeling chill and a bit sad").
  `/api/request` turns it into a song plus a few search phrases (Gemini when available, simple rules otherwise). It returns
  search terms only, never songs to play, so it can't invent a track. The app then finds the real video/track.
- A named song plays next (straight away if a song is on); then the queue continues with similar songs. The DJ takes the
  request on air ("You asked, I'm playing it…"), also when the AI writer is unavailable.
- Mood and genre tags (Chill, Happy, Sad, Love, Party, Workout, Focus, Throwbacks, Worship, Reggae, Dancehall, Soca, Punta,
  Latin, Reggaeton, Bachata, Regional, R&B, Hip-hop, Pop, Country) steer the next songs and are remembered; up to three at once.
- Requests use their own small YouTube search budget (12 per session; each search costs 101 of the 10,000 daily quota units).

## Library and playlist stations

- **Library → Station:** My Mix (default), My library (your YouTube likes and playlists, with a few similar songs) or any
  imported YouTube playlist (that playlist, plus one or two similar finds).
- **Add a playlist:** paste a public or unlisted YouTube / YouTube Music playlist link. It's read from the public page, so it
  costs no API quota. Typed lists and screenshots still work; on YouTube their artists steer the radio.
- **Up next** shows the queue.

## Lyrics

- Tap the speech-bubble button for fullscreen lyrics from [LRCLIB](https://lrclib.net) (free, open, no key) via `/api/lyrics`.
- Timing comes from the player's real position: the YouTube player's clock, the Spotify web player's state, or Spotify
  Connect's last reported position plus elapsed time. Pause holds the line; seeking in the video jumps the lyrics.
- Synced (LRC) lyrics highlight line by line; words are highlighted only when the file has word timestamps (enhanced LRC).
  Unsynced lyrics are shown as plain text and labelled as such.
- Limits: on Spotify Connect (iPhone) the position is re-read every 5 seconds while lyrics are open (every 30 seconds
  otherwise, to save API quota), so a seek made in the Spotify app shows up within 5 seconds. The DJ's own captions are still timed by estimate (the voice services return no
  word timings); they are captions, not song lyrics.

## Audio-reactive visuals

Spotify's and YouTube's players don't let a web page read their audio, so during songs the bars and glow follow the
playback state (playing / paused), not the sound. The DJ's voice is analysed for real on desktop Chrome and Edge, where the
browser allows it without re-routing the audio; elsewhere the DJ indicator uses a speech-like rhythm.

## Libraries

- **Added:** `motion` (Motion for React, pinned 14.14.0) for the spring card transitions, swipe drag, shared title animation,
  bottom sheets and the lyrics view. It is the only animation library in the app.
- **Not added:** a second animation library (react-spring, GSAP), a lyrics SDK (LRCLIB is a plain JSON API), a colour
  library (a 16×16 canvas average is enough for the glow), a gesture library (Motion's drag covers swipes), an audio
  analysis library (there is no audio to analyse for songs, see above).
- **Data sources, all free and keyless:** iTunes Search API for cover art, LRCLIB for lyrics. Both are called from our own
  server routes (`/api/art`, `/api/lyrics`), cached, rate-limited and same-origin guarded.

## Reliability fixes made alongside

- Play/pause on a remote Spotify Connect device waits for a burst of taps to settle (300 ms after the last tap, at most
  1.2 s) and sends one call. The DJ voice, YouTube and the in-browser Spotify player still react inside the tap, which iOS
  requires for audio to resume.
- On desktop, starting right after onboarding waits up to 5 s for the Spotify browser player to load instead of falling
  back to "open the Spotify app".
- The page entrance animation no longer moves the full-height player (it caused a brief 8 px scroll and cancelled the
  "player steps back behind the sheet" effect).
- Fallback DJ lines no longer repeat the same greeting back to back (the repeat check compared template text with
  placeholders against spoken text).

## Tests

`tests/e2e/player.spec.ts` covers: cover art with the YouTube video window still visible, art failure → fallback art,
swipe next and previous, rapid Next taps, lyrics following the player clock through pause and seek, a song request with
the DJ acknowledging it and similar songs after, a mood tag, a playlist station, and Previous on Spotify.

## Car mode and background play

iPhone freezes a web page when the screen locks or you switch apps, so MyRJ can't start the next song or DJ break until
it's back on screen. Car mode (the "Car" button while live) hides everything except the cover, title and three big
buttons, and keeps the screen awake with the Screen Wake Lock API (re-requested whenever the page comes back). If the
browser refuses the wake lock, it tells the listener to set Auto-Lock to Never while driving. When the page comes back
after iOS paused the YouTube player, the song resumes on its own, or shows "Tap to play" if iOS blocks that.
