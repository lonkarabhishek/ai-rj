import { stripTags } from "@/lib/text";
export { stripTags };
import { isRomantic, type Prefs, type TrackInfo, type Humor, type Language, type ListenMode } from "./prefs";
import type { Headline } from "./news";

export interface SegmentInput {
  prefs: Prefs;
  next?: TrackInfo | null;
  prev?: TrackInfo | null;
  index: number;
  mode?: ListenMode;
  recent?: string[];
  hour?: number;
  kind?: "stinger" | "full" | "switch"; // stinger = one line over the intro; full = a proper break
  withNews?: boolean;
  withJoke?: boolean;
 // listener's local hour, for time-of-day banter // recent scripts, used to avoid repeating lines
  headlines: Headline[];
  segment?: SegmentType; // the show bit for a full break (client rotates them)
  history?: { name: string; artists: string }[]; // songs played this session, oldest first
  trivia?: { q: string; a: string } | null; // a trivia question asked earlier: reveal the answer in this break
  minutes?: number; // how long this session has been on air
}

/** Recurring show bits for full breaks. "vibe" is the plain break. */
export type SegmentType = "vibe" | "story" | "trivia_q" | "trivia_a" | "hot_take" | "callback" | "dedication" | "sensual_story";
export const SEGMENTS: SegmentType[] = ["vibe", "story", "trivia_q", "trivia_a", "hot_take", "callback", "dedication", "sensual_story"];
const SEGMENT_RULES: Record<SegmentType, string> = {
  vibe: "Segment: a classic break. React to the song that just played or the moment (time of day, mood, the mode), then segue.",
  story: "Segment: THE STORY. Tell one real, specific story behind the next song or its artist (how it was made, the film or album it came from, the composer, the era, a famous moment). Only facts you are confident are true; if you are not sure of any specific fact, talk about why the song hits instead. Make it sound like a secret you're letting them in on.",
  trivia_q: "Segment: TRIVIA. Ask the listener one fun, fair trivia question about the next song, its artist, its film or its era, and tell them the answer comes after the song. Only ask a question whose answer you are certain of. After your spoken words, on a NEW final line, write ANSWER: followed by the answer in a few words (this line is hidden, never spoken).",
  trivia_a: "Segment: TRIVIA ANSWER. You asked a trivia question before the last song. Reveal the answer with a little drama first (\"toh jawab hai...\"), react playfully, then segue into the next song.",
  hot_take: "Segment: HOT TAKE. Give one playful, opinionated take on the song that just played or the next one (best line, best beat drop, rate it out of ten, a bold comparison). Confident, funny, never mean about real people.",
  callback: "Segment: CALLBACK. Connect this moment to songs played earlier in this session (listed above): spot a pattern, a mood arc, an artist coming back, or joke about the journey so far. Make the listener feel the show has been listening to them.",
  sensual_story: "Segment: A SHORT SENSUAL STORY (Romantic Hindi · Sensual only). This break replaces the usual 1 to 3 sentences: tell a complete little story of 70 to 140 words (30 to 60 seconds spoken slowly) in Devanagari Hindi, in your husky late-night voice. Two people, one charged moment: a monsoon night, the last local train, a power cut, a rooftop, a slow dance, strangers whose eyes keep meeting. Build tension with small details (rain on skin, a glance held too long, fingers brushing, a whisper, a breath close to the ear). Sensual and seductive, NEVER explicit: no sex acts, no nudity, nothing graphic or crude; fade out at the moment of a kiss or a closing door and let the listener imagine the rest. Fresh setting and characters each time (check your recent breaks). Then one short, slow line that leads into the next song by name.",
  dedication: "Segment: DEDICATION. Dedicate the next song, FM style, to a relatable group or moment (everyone stuck in traffic, the one friend who always sends reels at 2 am, whoever is missing someone tonight). Warm and specific, never about a real named private person.",
};

let RECENT: string[] = [];
const pick = (a: string[]) => {
  const fresh = a.filter((x) => !RECENT.some((r) => r.includes(x.slice(0, 25))));
  const pool = fresh.length ? fresh : a;
  return pool[Math.floor(Math.random() * pool.length)];
};

const GREET: Record<"en" | "hl" | "hi" | "mr", string[]> = {
  en: ["{rj} back with you, {me}", "Still here, still vibing, {me}", "That was a good one, {me}", "Okay {me}, keeping the streak going", "You know the drill, {me}", "{rj} on the mic again"],
  hl: ["{rj} wapas aa gaya, {me}", "Kya gaana tha yaar, {me}", "Mood ekdum set hai, {me}", "Chaliye {me}, aage badhte hain", "{rj} phir se mic pe", "Arre {me}, maza aa raha hai na?"],
  hi: ["{rj} फिर से हाज़िर है, {me}", "क्या गाना था, {me}", "मूड बना हुआ है, {me}", "चलिए {me}, आगे बढ़ते हैं"],
  mr: ["{rj} पुन्हा तुमच्यासोबत, {me}", "काय गाणं होतं, {me}", "मूड एकदम सेट आहे, {me}", "चला {me}, पुढे जाऊया"],
};
type K = "en" | "hl" | "hi" | "mr";
function banter(k: K, hour: number | undefined, me: string): string {
  const h = hour ?? 12;
  const slot = h < 5 ? "late" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "late";
  const B: Record<K, Record<string, string[]>> = {
    en: {
      morning: [`Morning energy check, ${me}: coffee first, world later.`, `Fresh morning, fresh playlist. Let's make today count.`],
      afternoon: [`Afternoon slump? Not on this station.`, `Half the day done, ${me}. The good half starts now.`],
      evening: [`Evening mode on. Shoulders down, volume up.`, `Long day, ${me}? This next stretch is just for you.`],
      late: [`Late night crew, I see you, ${me}.`, `It's late, the city's quiet, and the music's just right.`],
      any: [`Honestly ${me}, your taste in music is elite.`, `If this station had a fan club, you'd be president.`, `Little reminder: drink some water, ${me}.`],
    },
    hl: {
      morning: [`Good morning ${me}! Pehle chai, phir duniya.`, `Subah subah ka mood ekdum fresh hai.`],
      afternoon: [`Dopahar ki neend aa rahi hai? Is station pe allowed nahi hai.`, `Aadha din ho gaya ${me}, ab asli maza shuru.`],
      evening: [`Shaam ho gayi ${me}, thoda relax karo, volume badhao.`, `Lamba din tha? Ye agla stretch sirf aapke liye.`],
      late: [`Raat ke jaagne waalon ko salaam, ${me}.`, `Raat shaant hai, aur music ekdum perfect.`],
      any: [`Sach bolun ${me}, aapka music taste top class hai.`, `Is station ka fan club hota toh aap president hote.`, `Chhota sa reminder: paani pee lo, ${me}.`],
    },
    hi: {
      morning: [`सुप्रभात ${me}! पहले चाय, फिर दुनिया।`], afternoon: [`दोपहर की सुस्ती? इस स्टेशन पर मना है।`],
      evening: [`शाम हो गई ${me}, थोड़ा आराम कीजिए।`], late: [`रात के जागने वालों को सलाम, ${me}।`],
      any: [`सच कहूँ ${me}, आपकी पसंद कमाल की है।`, `छोटा सा रिमाइंडर: पानी पी लीजिए, ${me}।`],
    },
    mr: {
      morning: [`सुप्रभात ${me}! आधी चहा, मग जग.`], afternoon: [`दुपारची झोप? या स्टेशनवर नाही चालणार.`],
      evening: [`संध्याकाळ झाली ${me}, जरा आराम करा.`], late: [`रात्री जागणाऱ्यांना सलाम, ${me}.`],
      any: [`खरं सांगू ${me}, तुमची गाण्यांची आवड भारी आहे.`, `छोटीशी आठवण: पाणी प्या, ${me}.`],
    },
  };
  return pick([...B[k][slot], ...B[k].any]);
}

const UPNEXT: Record<"en" | "hl" | "hi" | "mr", string[]> = {
  en: ["Up next, {t}", "Here comes {t}", "Turning it up with {t}", "Let's roll into {t}", "Coming right up, {t}"],
  hl: ["Ab sunte hain {t}", "Agla gaana, {t}", "Volume up karo, aa raha hai {t}", "Chalo, {t} bajate hain", "Ye raha {t}"],
  hi: ["अब सुनिए {t}", "अगला गाना, {t}", "आवाज़ बढ़ाइए, आ रहा है {t}"],
  mr: ["आता ऐकूया {t}", "पुढचं गाणं, {t}", "आवाज वाढवा, येतंय {t}"],
};

// ---- Jokes (template mode). Keyed by humor; English + Hindi-ish variants.
const JOKES: Record<Exclude<Humor, "off">, { en: string[]; hi: string[]; mr: string[] }> = {
  clean: {
    en: ["My alarm and I have an agreement. It rings, I ignore it, we both move on.", "I tried to catch some fog this morning. I mist.", "Chai is not a drink, it is a meeting with yourself.", "Why did the playlist go to school? To get a little more class-ical.", "I told my speaker a joke. It didn't laugh, but it did get louder."],
    hi: ["मेरे फोन ने कहा बैटरी लो है, मैंने कहा मैं भी, चलो साथ में चार्ज होते हैं।", "गाना इतना अच्छा है कि मेरा हेडफोन भी नाच रहा है।"],
    mr: ["माझा फोन म्हणाला बॅटरी कमी आहे, मी म्हणालो मी पण, चल एकत्र चार्ज होऊया.", "हे गाणं इतकं भारी आहे की हेडफोन पण नाचतायत."],
  },
  normal: {
    en: ["Why do we park on a driveway and drive on a parkway? Nobody knows, keep listening.", "My Wi-Fi and I have a lot in common. We both disconnect when things get serious.", "I'm on a seafood diet. I see food, I skip the gym.", "My code works and I have no idea why. Same energy as my love life.", "Traffic in Pune is the only place where patience is a cardio workout."],
    hi: ["Monday को देखकर लगता है जैसे EMI की तरह हर हफ्ते आ ही जाता है।", "दोस्त बोला diet पर हूँ, फिर समोसा देखा, diet ने खुद resign कर दिया।"],
    mr: ["सोमवार म्हणजे EMI सारखा, दर आठवड्याला येतोच.", "मित्र म्हणाला डाएटवर आहे, मग वडापाव दिसला आणि डाएटने राजीनामा दिला."],
  },
  witty: {
    en: ["My to-do list and I are in a long-distance relationship. I never see the bottom of it.", "I asked the AI for life advice. It said: have you tried turning yourself off and on again?", "Every startup pitch now: it's like Uber, but for vibes, powered by AI.", "Pune weather has three settings: hot, rain, and confusing.", "AI can write code, compose music and pass exams, but still can't find the one sock the washing machine ate.", "My calendar says I'm productive. My screen time report disagrees, loudly."],
    hi: ["AI code लिख लेता है, गाने बना लेता है, पर washing machine ने जो मोजा खाया वो आज तक नहीं ढूंढ पाया।", "मेरा calendar कहता है मैं productive हूँ, screen time report कहती है झूठ मत बोल।"],
    mr: ["AI कोड लिहितो, गाणी बनवतो, पण वॉशिंग मशीनने खाल्लेला मोजा अजून सापडला नाही.", "कॅलेंडर म्हणतं मी productive आहे, स्क्रीन टाइम म्हणतो खोटं बोलू नकोस."],
  },
  dark: {
    en: ["My bank balance and my sleep schedule have one thing in common. Both are a cry for help.", "I'm not saying Monday is evil, but it has never once been seen in a mirror.", "I would tell you a joke about my career plans, but it doesn't have a punchline either.", "I told my plants about my deadlines. Two of them are no longer with us.", "They say money can't buy happiness. It can't buy rent either, apparently, so at least it's consistent."],
    hi: ["मैंने अपने पौधों को अपनी deadlines बताईं, दो पौधे अब हमारे बीच नहीं रहे।", "कहते हैं पैसा खुशी नहीं खरीद सकता, मेरे पास तो किराया खरीदने लायक भी नहीं, कम से कम consistent तो हूँ।"],
    mr: ["मी माझ्या झाडांना माझ्या deadlines सांगितल्या, दोन झाडं आता आपल्यात नाहीत.", "पैशाने सुख विकत घेता येत नाही म्हणतात, माझ्याकडे भाडं भरण्याइतके पण नाहीत, निदान सातत्य तरी आहे."],
  },
};

function jokeFor(humor: Humor, lang: Language) {
  if (humor === "off") return "";
  const set = JOKES[humor];
  return pick(lang === "english" || lang === "hinglish" ? set.en : lang === "marathi" ? set.mr : set.hi);
}

function shortTitle(t: string) { return t.length > 140 ? t.slice(0, 140).replace(/\s\S*$/, "") : t; }

function trackLine(t?: TrackInfo | null) {
  return t ? `"${t.name}" by ${t.artists}` : "";
}

const MODE_LINES: Record<"gym" | "drive" | "focus", Record<"en" | "hi" | "hl" | "mr", string[]>> = {
  gym: {
    en: ["Stronger than yesterday, {me}. Prove it!", "Your only competition is who you were last week!", "Form first, then fire!", "One more rep, {me}. Pain is temporary, gains are forever!", "No excuses today, {me}. Let's crush this set!", "Breathe, brace, and lift, {me}. You've got this!"],
    hl: ["Kal se strong ho aap, {me}, prove karo!", "Competition sirf pichle hafte waale aap se hai!", "Pehle form, phir fire!", "Ek aur rep, {me}! Dard temporary hai, gains permanent!", "Aaj koi excuse nahi, {me}. Set todo!", "Saans lo, focus karo, aur utha do, {me}!"],
    hi: ["एक और रेप, {me}! दर्द कुछ पल का है, ताकत हमेशा की!", "आज कोई बहाना नहीं, {me}। ये सेट तोड़ दो!"],
    mr: ["अजून एक रेप, {me}! वेदना क्षणभर, ताकद कायमची!", "आज कोणतीही सबब नाही, {me}. हा सेट फोडून टाका!"],
  },
  drive: {
    en: ["Long road, good company, better music.", "If there's traffic, this song is your excuse to sing louder.", "Windows down, volume up, {me}. Sing it like nobody's listening!", "Road's open, {me}. This one's a singalong, don't hold back!"],
    hl: ["Lambi road, achhi company, aur usse bhi achha music.", "Traffic mein phase ho? Toh aur zor se gaao!", "Windows neeche, volume upar, {me}! Gaana zor se gaana!", "Road khula hai, {me}. Is gaane pe singalong compulsory hai!"],
    hi: ["खिड़कियाँ नीचे, आवाज़ ऊपर, {me}! ज़ोर से गाइए!", "सड़क खुली है, {me}। इस गाने पर साथ में गाना ज़रूरी है!"],
    mr: ["खिडक्या खाली, आवाज वर, {me}! मोठ्याने गा!", "रस्ता मोकळा आहे, {me}. या गाण्यावर सोबत गायलंच पाहिजे!"],
  },
  focus: {
    en: ["Staying in the zone with {track}.", "Deep work continues, {me}. Next up, {track}.", "Quiet focus, steady flow. Here's {track}.", "You're doing great, {me}. Keep going with {track}."],
    hl: ["Focus mode on, {me}. Ab {track}.", "Zone mein raho, {me}. Next, {track}.", "Kaam chalta rahe, {me}. Saath mein {track}.", "Badhiya chal raha hai, {me}. Ab {track}."],
    hi: ["फोकस बनाए रखिए, {me}। अब {track}।"],
    mr: ["लक्ष केंद्रित ठेवा, {me}. आता {track}."],
  },
};

export function templateScript(input: SegmentInput): string {
  RECENT = input.recent ?? [];
  return templateInner(input);
}
function templateInner(input: SegmentInput): string {
  const { prefs, next, index, mode = "default" } = input;
  if (input.kind === "switch") {
    const k: K = prefs.language === "english" ? "en" : prefs.language === "hinglish" ? "hl" : prefs.language === "hindi" ? "hi" : "mr";
    const L: Record<ListenMode, Record<K, string>> = {
      gym: { en: "Gym mode on. Let's lift!", hl: "Gym mode on! Chalo, utha do!", hi: "जिम मोड ऑन! चलो, जोश दिखाओ!", mr: "जिम मोड ऑन! चला, जोर लावा!" },
      drive: { en: "Driving mode. Windows down, here we go!", hl: "Driving mode on! Seatbelt lagao, chalte hain!", hi: "ड्राइविंग मोड! सीटबेल्ट लगाइए, चलते हैं!", mr: "ड्रायव्हिंग मोड! सीटबेल्ट लावा, निघूया!" },
      focus: { en: "Focus mode. I'll keep it quiet.", hl: "Focus mode on. Main chup rahunga, aap kaam karo.", hi: "फोकस मोड। मैं चुप रहूँगा, आप काम कीजिए।", mr: "फोकस मोड. मी शांत राहतो, तुम्ही काम करा." },
      romantic_m: { en: "", hl: "", hi: "रात का सुकून, और दिल के क़रीब कुछ गाने।", mr: "" },
      romantic_f: { en: "", hl: "", hi: "चलिए, कुछ नर्म सी धुनें, कुछ दिल की बातें।", mr: "" },
      romantic_s: { en: "", hl: "", hi: "रोशनी थोड़ी कम कीजिए, आज की रात कुछ ज़्यादा ही गर्म है।", mr: "" },
      default: { en: "Back to your mix!", hl: "Wapas aapke mix pe!", hi: "वापस आपके मिक्स पर!", mr: "परत तुमच्या मिक्सवर!" },
    };
    return L[mode][k];
  }
  if (input.kind === "stinger" && index > 0) {
    const k: K = prefs.language === "english" ? "en" : prefs.language === "hinglish" ? "hl" : prefs.language === "hindi" ? "hi" : "mr";
    const tl = trackLine(next);
    if (!tl) return "";
    if (isRomantic(mode)) return "";
    if (mode === "gym" || mode === "focus") return pick(MODE_LINES[mode][k]).replace("{me}", prefs.listenerName).replace("{track}", tl);
    if (prefs.justMusic || (prefs.talk && !prefs.talk.news && !prefs.talk.jokes && !prefs.talk.facts)) return pick(UPNEXT[k]).replace("{t}", tl) + "."; // listener asked for minimal intros
    return ""; // never a bare "Up next: <song>": stay silent when Claude couldn't write a real line
  }
  return templateFull(input);
}
/** Fallback stories for Romantic Hindi · Sensual when Claude is unavailable (~30-40s each, suggestive, never explicit). */
const SENSUAL_STORIES = [
  "बाहर बारिश थी, और कमरे में बस एक धीमी सी रोशनी। वो खिड़की के पास खड़ी थी, भीगे बालों से पानी की बूँदें गिर रही थीं। उसने पलटकर देखा, कुछ कहा नहीं। कभी कभी ख़ामोशी सबसे ज़्यादा बोलती है। वो धीरे से पास आया, इतना पास कि साँसों की आवाज़ भी सुनाई दे। उसकी उँगलियों ने उसका हाथ छुआ, और रात ने बाक़ी कहानी अपने पास रख ली।",
  "आख़िरी लोकल छूट चुकी थी, प्लेटफ़ॉर्म पर बस वो दोनों। अजनबी थे, पर नज़रें बार बार मिल रही थीं। उसने अपनी छतरी आगे बढ़ाई, साथ चलें? बारिश तेज़ थी और छतरी छोटी। कंधे छू गए, फिर हाथ। किसी ने कुछ नहीं कहा, पर दोनों जानते थे, ये रात इतनी आसानी से ख़त्म नहीं होगी।",
  "बिजली चली गई थी। पूरी बिल्डिंग में अँधेरा, और छत पर बस चाँद। वो दोनों मुंडेर से टिके, एक दूसरे की धड़कन सुन रहे थे। हवा में मिट्टी की ख़ुशबू थी। उसने धीरे से उसके कान के पास कुछ कहा, और वो मुस्कुरा दी। फिर लाइट आ गई, पर उन्होंने आँखें नहीं खोलीं।",
];
function templateFull({ prefs, next, index, headlines, mode = "default", hour: input_hour, withJoke, segment }: SegmentInput): string {
  if (isRomantic(mode)) {
    const tl = trackLine(next), me = prefs.listenerName;
    if (mode === "romantic_s" && segment === "sensual_story") return pick(SENSUAL_STORIES) + (tl ? ` ${pick(UPNEXT.hi).replace("{t}", tl)}।` : "");
    const opener = index === 0 ? `${prefs.rjName} हाज़िर है, ${me}। ` : "";
    const lines = mode === "romantic_s"
      ? ["रात गहरी है, और फ़ासले कुछ ज़्यादा ही कम, {me}।", "कुछ धुनें सुनी नहीं जातीं, महसूस की जाती हैं।", "साँसें थोड़ी धीमी, धड़कनें थोड़ी तेज़। सुनिए, {me}।", "आज की रात, थोड़ी सी बेक़रारी के नाम।"]
      : mode === "romantic_m"
      ? ["रात ख़ामोश है, और मैं बस तुम्हारे साथ हूँ, {me}।", "कुछ बातें कहनी नहीं पड़तीं, गाने कह देते हैं।", "इश्क़ शोर नहीं करता, {me}, बस धीरे से दिल में उतर जाता है।", "आज की रात, इन सुरों के नाम।"]
      : ["रात नर्म है, और ये धुन तुम्हारे लिए, {me}।", "कभी कभी ख़ामोशी भी मोहब्बत की ज़ुबान होती है।", "धीमे धीमे, दिल से दिल तक, सुनिए {me}।", "ये गाना उसके नाम, जो आपके दिल के बहुत क़रीब है।"];
    return opener + pick(lines).replace("{me}", me) + (tl ? ` ${pick(UPNEXT.hi).replace("{t}", tl)}।` : "");
  }
  if (mode !== "default") {
    const k: K = prefs.language === "english" ? "en" : prefs.language === "hinglish" ? "hl" : prefs.language === "hindi" ? "hi" : "mr";
    const me = prefs.listenerName;
    const fill = (x: string) => x.replace("{me}", me).replace("{track}", trackLine(next) || "the next one");
    const tl = trackLine(next);
    const upnext = tl ? pick(UPNEXT[k]).replace("{t}", tl) + "!" : "";
    const intro = index === 0 ? `${prefs.rjName} ${k === "en" ? "here" : k === "hl" ? "aa gaya" : k === "hi" ? "हाज़िर है" : "आला"}! ` : "";
    if (mode === "focus") return intro + fill(pick(MODE_LINES.focus[k]));
    if (mode === "gym") {
      const l1 = fill(pick(MODE_LINES.gym[k]));
      RECENT = [...RECENT, l1];
      const l2 = fill(pick(MODE_LINES.gym[k]));
      return [intro + l1, l2 !== l1 ? l2 : "", upnext].filter(Boolean).join(" ");
    }
    // drive: banter + road line + joke + a headline every other break + intro
    const g0 = index === 0 ? "" : pick(GREET[k]).replace("{rj}", prefs.rjName).replace("{me}", me);
    const g = g0 && !/[?!]$/.test(g0) ? g0 + "!" : g0;
    const news = headlines[0] ? `${k === "en" ? "On the news front" : k === "hl" ? "Ek quick khabar" : k === "hi" ? "एक ताज़ा खबर" : "एक ताजी बातमी"}: ${shortTitle(headlines[0].title)}.` : "";
    const joke = prefs.humor !== "off" && withJoke !== false && prefs.talk?.jokes !== false ? jokeFor(prefs.humor, prefs.language) : "";
    return [(intro + g).trim(), fill(pick(MODE_LINES.drive[k])), news, joke, upnext].filter(Boolean).join(" ");
  }
  const { rjName, listenerName: me, language, humor, energy } = prefs;
  const hype = energy === "hype" ? "!" : ".";
  const joke = withJoke === false || prefs.talk?.jokes === false ? "" : jokeFor(humor, language);
  const news = headlines.slice(0, 2).map((h) => ({ ...h, title: shortTitle(h.title) }));
  const tl = trackLine(next);
  const parts: string[] = [];
  const k = language === "english" ? "en" : language === "hinglish" ? "hl" : language === "hindi" ? "hi" : "mr";
  const greetRaw = pick(GREET[k]).replace("{rj}", rjName).replace("{me}", me);
  const greet = /[?!]$/.test(greetRaw) ? greetRaw : greetRaw + hype;
  const upnext = tl ? pick(UPNEXT[k]).replace("{t}", tl) + hype : "";
  const chat = banter(k, input_hour, me);

  switch (language) {
    case "english":
      parts.push(index === 0 ? `Hey ${me}, you're tuned in to ${rjName}, your very own radio${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`Quick news check: ${news.map((h) => h.title).join(". Also, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    case "hindi":
      parts.push(index === 0 ? `नमस्ते ${me}, आप सुन रहे हैं ${rjName}, सिर्फ आपका अपना रेडियो${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`ताज़ा खबरें: ${news.map((h) => h.title).join("। और, ")}।`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    case "marathi":
      parts.push(index === 0 ? `नमस्कार ${me}, तुम्ही ऐकताय ${rjName}, फक्त तुमचा स्वतःचा रेडिओ${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`ताज्या बातम्या: ${news.map((h) => h.title).join(". आणि, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
      break;
    default: // hinglish
      parts.push(index === 0 ? `Hello ${me}, aap sun rahe ho ${rjName}, sirf aapka apna radio${hype}` : greet);
      parts.push(chat);
      if (news.length) parts.push(`Quick news update: ${news.map((h) => h.title).join(". Aur, ")}.`);
      if (joke) parts.push(joke);
      if (upnext) parts.push(upnext);
  }
  return parts.join(" ");
}

const LANG_RULES: Record<string, string> = {
  english: "Speak natural Indian English, the way a Mumbai or Bangalore FM host talks.",
  hinglish: "Speak natural Hinglish in Roman script: Hindi and English mixed mid-sentence the way young urban Indians actually talk, the way a Mumbai FM host does at prime time (e.g. 'Yaar, ye gaana toh full nostalgia trip hai', 'Sach bataun? Is chorus pe main har baar haar jaati hoon', 'Chalo, volume thoda aur, kyunki ab aa raha hai...'). Spell Hindi words the common texting way (hai, nahi, kya, yaar). No Devanagari.",
  hindi: "Speak conversational Hindi in Devanagari script. Common English words (song, playlist, AI, office) are fine as Indians say them.",
  marathi: "Speak conversational Marathi in Devanagari script, warm Pune/Mumbai FM style. Common English words are fine as Marathi speakers use them.",
};
const HUMOR_RULES: Record<string, string> = {
  off: "No jokes at all.",
  clean: "Humor: clean, family-friendly, light wordplay.",
  normal: "Humor: everyday relatable observational jokes (traffic, Mondays, chai, office life).",
  witty: "Humor: sharp, clever, dry wit with a real punchline; tech and startup jokes welcome.",
  dark: "Humor: dark, deadpan and self-deprecating (deadlines, bank balance, existential dread), never cruel about real tragedies or groups of people.",
};
const MODE_RULES: Record<string, string> = {
  romantic_m: "Mode: Romantic Hindi, masculine voice. A deep, calm, confident late-night RJ: slow, warm, poetic Devanagari Hindi. Shayari-style one-liners, soft dedications, an intimate hush. Romantic and sensual in tone, never explicit or crude. No news, no jokes, no hype. 1 to 3 short sentences, then a gentle segue naming the next song.",
  romantic_s: "Mode: Romantic Hindi · Sensual, deep masculine voice, played over sensual, seductive Bollywood songs. A slow, husky, late-night RJ: teasing, flirtatious, full of heat and tension. Poetic Devanagari Hindi with innuendo and longing: closeness, breath, a touch, rain on skin, the night. Suggestive and seductive, NEVER explicit, graphic or crude: no sexual acts, no body parts beyond lips, eyes, hands and hair, nothing vulgar. No news, no jokes, no hype. 1 to 3 short sentences, then a slow, teasing segue naming the next song.",
  romantic_f: "Mode: Romantic Hindi, sultry feminine voice. A warm, intimate, sultry late-night RJ: soft, unhurried, poetic Devanagari Hindi. Shayari-style one-liners, tender dedications, a whisper-close feel. Romantic and sensual in tone, never explicit or crude. No news, no jokes, no hype. 1 to 3 short sentences, then a gentle segue naming the next song.",
  default: "Mode: My Mix. A normal break: 2 to 5 sentences. Real banter, a joke when asked, news when given, then a smooth segue into the next song.",
  drive: "Mode: Driving. Road-trip buddy energy: playful, sing-along vibes, mention the road or the drive. 2 to 4 sentences, joke when asked, news when given, then the segue.",
  gym: "Mode: Gym. Hype coach energy. 2 to 3 short punchy sentences, motivational, no news, no long jokes. End by firing up the next song.",
  focus: "Mode: Work/Focus. Calm and minimal. ONE short sentence (max 15 words) that gently names the next track. No jokes, no news.",
};

export function systemPrompt(p: SegmentInput["prefs"], mode: ListenMode) {
  return `You are ${p.rjName}, a charismatic Indian FM radio jockey hosting a private, one-listener radio show for ${p.listenerName} on MyRJ. Think the warmth and wit of the best Indian FM RJs: quick, playful, effortlessly cool, genuinely fond of your listener.

Your personality (stay consistent across the whole show):
- You have opinions about music and share them: favourite lines, the beat that gets you, the singer who never misses. Light teasing of the listener is fine; meanness is not.
- The show has memory. When the breaks below show what already happened (songs played, a trivia question), build on it like a running conversation, not a reset.
- You have a signature sign-on for the show: "${p.rjName}, on MyRJ, sirf ${p.listenerName} ke liye" (or the same idea in the show's language). Use it in the opener and only rarely after that.
- Sound like a person on a live mic: little reactions ("uff", "arre", "wait wait"), a quick laugh, then straight back to it. Never sound like an announcer reading a script.

How you talk:
- ${LANG_RULES[p.language] ?? LANG_RULES.english}
- Energy: ${p.energy} (chill = mellow and warm, balanced = upbeat and friendly, hype = loud, fast, exclamation-heavy).
- ${HUMOR_RULES[p.humor] ?? HUMOR_RULES.normal}
- ${MODE_RULES[mode] ?? MODE_RULES.default}
- Talk about the actual next song and artist like a music lover: a real fact, the mood, the era, or why it fits this moment, mode or time of day. Never invent fake facts; if unsure, talk about the vibe instead.
- When headlines are provided, retell one or two conversationally in your own words, like telling a friend, with a quick reaction. Don't read them out verbatim.
- Segue smoothly from banter into the song; the very last thing you say introduces the next track by name.
- Use ${p.listenerName}'s name sometimes, not every time.
- Never repeat openers, jokes, phrases or structures from the recent breaks you are shown. Vary how you start.

Written for speech, read aloud by a TTS voice:
- Output ONLY the words to speak. No emojis, markdown, hashtags, quotes around the whole thing, stage directions or sound effects.
- Spell numbers and symbols naturally ("twenty twenty-six", "ten percent").
- Short, rhythmic sentences that sound good out loud.
- ${mode.startsWith("romantic") ? "Always Devanagari Hindi (song and artist names may stay in English). Use [warm] or [calm] as the delivery tag. " : ""}Start your reply with a delivery tag for the voice, exactly one of [hype] [cheerful] [warm] [calm], matching the line's energy (e.g. [hype] for gym, [cheerful] for a fun break, [warm] for a heartfelt song, [calm] for focus). Then the words.

Never use filler like "that was a great song" or "what a song": every line should be a story, an opinion, a joke, a feeling or a real moment.${
  mode.startsWith("romantic") || mode === "focus" ? " In this mode silence is part of the style: if you have nothing good, reply with exactly SKIP and the music just keeps flowing." : ""}`;
}

/** Pulls the hidden "ANSWER: ..." line a trivia question carries, so it is never spoken. */
export function splitAnswer(t: string): { text: string; answer?: string } {
  const m = t.match(/\s*\bANSWER\s*:\s*(.+?)\s*$/i);
  if (!m || m.index === undefined) return { text: t };
  return { text: t.slice(0, m.index).trim(), answer: m[1].replace(/[.\s]+$/, "").slice(0, 120) };
}

/** The segment this break actually runs: anything that doesn't fit the break, mode or toggles becomes a plain break. */
export function segmentFor(input: SegmentInput): SegmentType {
  const s = input.segment && SEGMENTS.includes(input.segment) ? input.segment : "vibe";
  const mode = input.mode ?? "default";
  if (s === "sensual_story") return mode === "romantic_s" && (input.kind === "full" || input.kind === undefined) && input.index > 0 ? s : "vibe";
  if ((input.kind !== "full" && input.kind !== undefined) || input.index === 0 || isRomantic(mode) || mode === "gym" || mode === "focus") return "vibe";
  const facts = input.prefs.talk?.facts !== false && !input.prefs.justMusic;
  if ((s === "story" || s === "trivia_q") && !facts) return "vibe";
  if (s === "trivia_a" && !input.trivia) return "vibe";
  if (s === "callback" && (input.history?.length ?? 0) < 3) return "vibe";
  return s;
}

/** Model per break: full breaks get the stronger writer, short lines the fast one. */
export function modelFor(input: Pick<SegmentInput, "kind" | "index" | "mode">) {
  if (input.mode === "romantic_s") return process.env.ANTHROPIC_MODEL_SENSUAL || "claude-sonnet-5-5"; // Sensual: every line (and its stories) by Sonnet
  const short = (input.kind === "stinger" && input.index > 0) || input.kind === "switch";
  return short ? (process.env.ANTHROPIC_MODEL || "claude-haiku-5-5") : (process.env.ANTHROPIC_MODEL_FULL || "claude-sonnet-5-5");
}
/** Request body per model family: Sonnet 5.5 / Opus 5.5 reject disabled thinking and custom sampling; Haiku keeps the fast settings. */
function anthropicBody(model: string, system: string, user: string) {
  const base = { model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] };
  if (model.includes("sonnet-5-5")) return { ...base, thinking: { type: "between_tools" }, output_config: { effort: "low" }, fallbacks: "default" };
  if (/opus-4-[0-6]\b/.test(model)) return { ...base, temperature: 1 }; // Opus 4.x: no `thinking` field means no thinking (fast)
  if (/opus|fable|mythos/.test(model)) return { ...base, output_config: { effort: "low" }, ...(model.includes("opus-5-5") ? { fallbacks: "default" } : {}) }; // thinking can't be turned off there: keep it shallow
  return { ...base, temperature: 1, thinking: { type: "disabled" } }; // speed matters more than reasoning for a short line
}
const anthropicHeaders = (key: string, model: string): Record<string, string> => ({
  "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
  ...(/sonnet-5-5|opus-5-5/.test(model) ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
});

/** Writes the RJ script with an LLM. Anthropic Claude first, then any OpenAI-compatible API. Null on failure/timeout. */
export function splitMood(t: string): { mood?: "hype" | "cheerful" | "warm" | "calm"; text: string } {
  const m = t.match(/^\s*\[([a-z]+)\]\s*/i);
  const mood = m && (["hype", "cheerful", "warm", "calm"].includes(m[1].toLowerCase()) ? (m[1].toLowerCase() as "hype") : undefined);
  return { mood: mood || undefined, text: stripTags(t) };
}

export async function llmScript(input: SegmentInput): Promise<string | null> {
  const { prefs, next, prev, index, headlines } = input;
  const mode = input.mode ?? "default";
  const h = input.hour ?? 12;
  const timeOfDay = h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  const stinger = input.kind === "stinger" && index > 0;
  const isSwitch = input.kind === "switch";
  const rom = isRomantic(mode);
  const wantNews = !stinger && !isSwitch && !rom && mode !== "gym" && mode !== "focus" && headlines.length > 0;
  const wantJoke = !stinger && !isSwitch && !rom && mode !== "gym" && mode !== "focus" && prefs.humor !== "off" && input.withJoke !== false && prefs.talk?.jokes !== false;
  const noFacts = prefs.talk?.facts === false;
  const seg = segmentFor(input);
  const played = (input.history ?? []).slice(-8).map((t) => `"${t.name}" by ${t.artists}`);
  const user = [
    `Break number ${index + 1}. Listener's local time: ${timeOfDay}.${input.minutes ? ` On air together for ${input.minutes} minutes.` : ""}`,
    index === 0 ? "This is the show opener: welcome them in with your sign-on and real energy." : `Song that just finished: ${trackLine(prev) || "unknown"}.`,
    `Next song to introduce: ${trackLine(next) || "(none yet, just keep them company)"}.`,
    played.length > 1 && !stinger && !isSwitch ? `Played so far this session (oldest first): ${played.join("; ")}.` : "",
    isSwitch ? `The listener just switched to ${mode === "default" ? "My Mix" : rom ? "Romantic Hindi" : mode} mode. Say ONE short, fitting transition line (under 12 words) that acknowledges the switch with the new energy, then nothing else. Do not SKIP.` :
    stinger ? "This is a STINGER: ONE short line (under 15 words) said over the song's intro: a quick fact, a reaction or the vibe of the next song. If you truly have nothing, reply SKIP." :
      seg === "sensual_story" ? "This is a STORY break between two songs: the story (70 to 140 words), then one line naming the next song. Do not SKIP." :
      `This is a full break, spoken over the end of one song and the start of the next: 2 to 5 sentences, under ${seg === "story" || seg === "trivia_a" ? 90 : 70} words total.${rom || mode === "focus" ? " If you truly have nothing worth saying, reply SKIP." : " Do not SKIP."}`,
    !stinger && !isSwitch && seg !== "vibe" ? SEGMENT_RULES[seg] : "", // segmentFor() already keeps romantic modes to their own bits
    seg === "trivia_a" && input.trivia ? `The question you asked: "${input.trivia.q}" The correct answer: ${input.trivia.a}.` : "",
    prefs.language === "hindi" || prefs.language === "marathi" ? `Write in ${prefs.language === "hindi" ? "Hindi" : "Marathi"} using Devanagari script (song and artist names may stay in English).` : prefs.language === "hinglish" ? "Write in Hinglish, Roman script." : "Write in English.",
    wantNews ? `Headlines to weave in (pick one or two): ${headlines.slice(0, 3).map((x) => x.title).join(" | ")}` : "No news in this break.",
    wantJoke ? "Include one joke with a real punchline in their humor style." : "No jokes in this break.",
    noFacts ? "Do NOT share song or artist facts or trivia; just name the song and the mood." : "",
    input.recent?.length ? `Your recent breaks (do NOT repeat their openers, jokes or phrasing):\n- ${input.recent.slice(-4).join("\n- ")}` : "",
  ].filter(Boolean).join("\n");
  // Newlines are kept until the hidden ANSWER line is split off (route.ts), then collapsed there.
  const clean = (t?: string | null) => t?.replace(/[*_#`]/g, "").replace(/^(\s*\[[a-z]+\]\s*)?["']/i, "$1").replace(/["']$/, "").replace(/[ \t]+/g, " ").trim() || null;
  const isSkip = (t: string) => /^(\[\w+\]\s*)?skip\.?$/i.test(t);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    // Full breaks: the stronger model first, then the fast one if it fails or is slow (breaks are prefetched during the song).
    const primary = modelFor(input), fast = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
    const chain = primary === fast ? [primary] : [primary, fast];
    const long = seg === "sensual_story"; // a 30-60s story takes longer to write (it is prefetched during the song)
    const budget = Number(process.env.LLM_TIMEOUT_MS ?? (long ? 22000 : chain.length > 1 ? 16000 : 8000)), t0 = Date.now();
    for (const [i, model] of chain.entries()) {
      const left = budget - (Date.now() - t0);
      if (left < 2500) break;
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: AbortSignal.timeout(i === 0 && chain.length > 1 ? Math.min(left - 3000, long ? 18000 : 12000) : left),
          headers: anthropicHeaders(anthropicKey, model),
          body: JSON.stringify(anthropicBody(model, systemPrompt(prefs, mode), user)),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.stop_reason === "refusal") { console.error("anthropic refusal", model); continue; }
          const t = clean((j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join(" "));
          if (!t) console.error("anthropic: no text", model, j.stop_reason);
          if (t) return isSkip(t) ? "" : t;
        } else console.error("anthropic", model, res.status, (await res.text()).slice(0, 200));
      } catch (e) { console.error("anthropic failed", model, e); }
    }
    return null;
  }
  const signal = AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 8000));

  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${process.env.LLM_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.LLM_MODEL || "gpt-4o-mini", temperature: 0.95,
        messages: [{ role: "system", content: systemPrompt(prefs, mode) }, { role: "user", content: user }] }),
    });
    if (!res.ok) return null;
    const t = clean((await res.json()).choices?.[0]?.message?.content);
    return t && /^(\[\w+\]\s*)?skip\.?$/i.test(t) ? "" : t;
  } catch { return null; }
}
