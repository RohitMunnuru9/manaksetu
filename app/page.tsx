"use client";

import {
  ArrowRight, BarChart3, BookOpenCheck, Check, CheckCircle2, ChevronRight, Clock3, FileCheck2,
  FileSearch, FileText, History, LayoutDashboard, Link2, LoaderCircle, LockKeyhole,
  Globe2, LogOut, Menu, Search, Share2, ShieldCheck, Sparkles, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  PERMISSIONS, analyseFile, analyseTender, downloadReport, getAuditHistory, getBriefing,
  getCategories, getCurrentUser, getDashboardStats, getLatestAnalysis, getNetwork, getStandards, login as loginUser,
  logout, saveReview,
  type AnalysisResult, type ApiCategory, type ApiRecommendation, type ApiStandard, type AuditEntry,
  type DashboardStats, type StandardNetwork, type UserProfile,
} from "@/lib/api";
import { AnalyticsView } from "./components/analytics";
import { ScorecardPanel } from "./components/scorecard";
import { DraftPanel } from "./components/draft";

type View = "overview" | "analyse" | "network" | "standards" | "analytics" | "reports" | "audit";

/* ---------------------------------------------------------------------
   Plain-language helpers.
   Everything an officer reads is written here, once, in ordinary words.
   The API's internal vocabulary never reaches the screen.
   --------------------------------------------------------------------- */

type Tier = "verified" | "checking" | "example";

function tierOf(standard: ApiStandard): Tier {
  if (standard.verification_status === "verified" && standard.standard_number) return "verified";
  if (standard.standard_number) return "checking";
  return "example";
}

const TIER_LABEL: Record<Tier, string> = {
  verified: "Verified",
  checking: "Needs checking",
  example: "Example only",
};

const TIER_CLASS: Record<Tier, string> = { verified: "green", checking: "amber", example: "grey" };

const TIER_MEANING: Record<Tier, string> = {
  verified: "Someone has checked this against the official BIS record. You can use it, once you are happy with it.",
  checking: "The number is real and came from an official BIS page, but nobody has checked the title and year yet. Open the source link and confirm before you use it.",
  example: "A stand-in used to show how the system works. It has no standard number, so never put it in a tender.",
};

/** "tested_by of IS 2925:1984" -> "Test method for IS 2925:1984" */
function plainRelation(note: string | null): string | null {
  if (!note) return null;
  const [kind, , target] = [note.split(" of ")[0], "", note.split(" of ")[1]];
  const word: Record<string, string> = {
    tested_by: "Test method for",
    safety: "Safety rules for",
    terminology: "Definitions used by",
    references: "Referred to by",
    installation: "Installation rules for",
  };
  return `${word[kind] ?? "Linked to"} ${target}`;
}

/** The role of a result, in words rather than a code. */
function plainRole(type: string): string {
  const words: Record<string, string> = {
    primary: "Main standard",
    allied: "Related",
    test: "Test method",
    safety: "Safety",
    terminology: "Definitions",
    installation: "Installation",
    "normative reference": "Referenced",
  };
  return words[type] ?? type;
}

// Demonstration accounts. Seeded only where SEED_DEMO_USERS is true, and the
// API refuses every request without a token regardless.
const DEMO_OFFICER = { email: "officer@manaksetu.gov.in", password: "ManakSetu@2026" };
const DEMO_SUPPLIER = { email: "supplier@example.in", password: "ManakSetu@2026" };


/* ---------------------------------------------------------------------
   Interface language. The tender itself is always read in whatever
   language it was written in -- this only changes the words around it, so
   an officer can work in their own language.
   --------------------------------------------------------------------- */

type UiLang = "en" | "hi" | "te" | "ta";

const UI_LANGS: Array<{ code: UiLang; label: string; native: string }> = [
  { code: "en", label: "EN", native: "English" },
  { code: "hi", label: "हि", native: "हिन्दी" },
  { code: "te", label: "తె", native: "తెలుగు" },
  { code: "ta", label: "த", native: "தமிழ்" },
];

const T: Record<UiLang, Record<string, string>> = {
  en: {
    overview: "Overview", analyse: "Analyse a tender", network: "How they connect",
    standards: "Standards list", reports: "Download report", history: "History",
    signOutOfficer: "Switch to supplier", signOutSupplier: "Switch to officer",
    heroTitle: "Procurement decisions, grounded in evidence.",
    heroLede: "Turn a tender into a list of Indian Standards you can defend — each one traced back to an official source.",
    newTender: "Analyse a new tender", browse: "Browse standards",
    whatBuying: "What are you buying?", describe: "Describe the purchase",
    shortTitle: "Short title", whatBuyingQ: "What are you buying?",
    typeIt: "Type it", uploadFile: "Upload a file", findStandards: "Find the standards",
    working: "Working…", step1: "Step 1 of 2", understood: "Here is what we understood",
    showStandards: "Now show me the standards", thatsWrong: "That is wrong — let me edit",
    tabResults: "Standards found", tabRead: "What we read", tabGaps: "Things to fix",
    briefing: "Plain-English summary", decision: "Your decision", approve: "Approve",
    readAs: "Read as", searchPlaceholder: "Search standards by name…",
    startNew: "Start a new analysis", verified: "Verified",
    checking: "Needs checking", example: "Example only",
    analytics: "Analytics",
    statCatalogue: "Standards in the catalogue", statCatalogueNote: "Harvested from the official BIS catalogue service.",
    statTenders: "Tenders analysed", statTendersNote: "Every analysis is kept in the history.",
    statInvented: "Invented standard numbers", statInventedNote: "Numbers only ever come from the catalogue. The AI cannot write one.",
    statExpiring: "Validity ends within 180 days", statExpiringNote: "Official BIS validity dates, checked automatically.",
    evidenceMix: "Where the evidence stands", evidenceMixLede: "Every record wears its tier. Nothing is presented as more certain than it is.",
    topStandards: "Most relied-on standards", topStandardsLede: "Across every analysis saved on this system.",
    langMix: "Tenders by language", langMixLede: "Analyses run in the language the tender arrived in.",
    topSectors: "Largest BIS sectors in the catalogue",
    watchTitle: "Currency watch", watchLede: "Standards your analyses rely on that need attention — superseded, unconfirmed, or approaching their validity date.",
    watchClear: "Nothing needs attention. Every standard in use is current.",
    watchStandard: "Standard", watchIssue: "Issue", watchDetail: "What to do",
    tabScore: "Spec scorecard", tabDraft: "Draft clauses",
    scoreExplain: "How complete this specification document is, judged by fixed rules — the same document always scores the same. It measures the paperwork, not the product.",
    scoreFootnote: "Scored deterministically against a fixed checklist. No AI is involved in this score.",
    gradeReady: "ready", gradeNeedsWork: "needs work", gradeIncomplete: "incomplete",
    draftButton: "Draft the clauses", draftWorking: "Drafting…",
    draftHint: "Builds standards, certification and testing clauses from the retrieved records only.",
    draftFailed: "Drafting failed — is the API running?",
    draftNothing: "No record with a real standard number was retrieved, so no clause can honestly be drafted.",
    draftSourceRules: "Rule-built text", draftSourceModel: "Polished by the local model",
    draftCopy: "Copy", draftCopied: "Copied",
    draftFootnote: "Every standard number in this draft came from retrieval. A model rewrite that invents one is discarded automatically.",
    whereFrom: "Where this comes from in your tender",
  },
  hi: {
    overview: "अवलोकन", analyse: "निविदा विश्लेषण", network: "आपसी संबंध",
    standards: "मानक सूची", reports: "रिपोर्ट डाउनलोड", history: "इतिहास",
    signOutOfficer: "आपूर्तिकर्ता में बदलें", signOutSupplier: "अधिकारी में बदलें",
    heroTitle: "साक्ष्य पर आधारित क्रय निर्णय।",
    heroLede: "निविदा को ऐसे भारतीय मानकों की सूची में बदलें जिनका आप बचाव कर सकें — प्रत्येक आधिकारिक स्रोत से जुड़ा हुआ।",
    newTender: "नई निविदा का विश्लेषण", browse: "मानक देखें",
    whatBuying: "आप क्या खरीद रहे हैं?", describe: "खरीद का विवरण दें",
    shortTitle: "संक्षिप्त शीर्षक", whatBuyingQ: "आप क्या खरीद रहे हैं?",
    typeIt: "टाइप करें", uploadFile: "फ़ाइल अपलोड करें", findStandards: "मानक खोजें",
    working: "कार्य जारी…", step1: "चरण 1 / 2", understood: "हमने यह समझा है",
    showStandards: "अब मानक दिखाएँ", thatsWrong: "यह गलत है — सुधार करें",
    tabResults: "मिले मानक", tabRead: "हमने क्या पढ़ा", tabGaps: "सुधार योग्य",
    briefing: "सरल भाषा में सारांश", decision: "आपका निर्णय", approve: "स्वीकृत करें",
    readAs: "इस भाषा में पढ़ा", searchPlaceholder: "नाम से मानक खोजें…",
    startNew: "नया विश्लेषण शुरू करें", verified: "सत्यापित",
    checking: "जाँच आवश्यक", example: "केवल उदाहरण",
    analytics: "विश्लेषिकी",
    statCatalogue: "सूची में मानक", statCatalogueNote: "आधिकारिक BIS सूची सेवा से लिए गए।",
    statTenders: "विश्लेषित निविदाएँ", statTendersNote: "हर विश्लेषण इतिहास में सुरक्षित रहता है।",
    statInvented: "गढ़े गए मानक क्रमांक", statInventedNote: "क्रमांक केवल सूची से आते हैं। AI इन्हें लिख नहीं सकता।",
    statExpiring: "180 दिनों में वैधता समाप्त", statExpiringNote: "आधिकारिक BIS वैधता तिथियाँ, स्वतः जाँची गईं।",
    evidenceMix: "साक्ष्य की स्थिति", evidenceMixLede: "हर रिकॉर्ड अपना स्तर दिखाता है। कुछ भी वास्तविकता से अधिक निश्चित नहीं दिखाया जाता।",
    topStandards: "सबसे अधिक उपयोग हुए मानक", topStandardsLede: "इस प्रणाली पर सहेजे गए सभी विश्लेषणों में।",
    langMix: "भाषा के अनुसार निविदाएँ", langMixLede: "निविदा जिस भाषा में आई, उसी में विश्लेषण हुआ।",
    topSectors: "सूची के सबसे बड़े BIS क्षेत्र",
    watchTitle: "वैधता निगरानी", watchLede: "आपके विश्लेषण जिन मानकों पर आधारित हैं, उनमें से जिन पर ध्यान चाहिए — प्रतिस्थापित, अपुष्ट, या वैधता समाप्ति के निकट।",
    watchClear: "किसी पर ध्यान की आवश्यकता नहीं। उपयोग में हर मानक वर्तमान है।",
    watchStandard: "मानक", watchIssue: "समस्या", watchDetail: "क्या करें",
    tabScore: "विनिर्देश स्कोरकार्ड", tabDraft: "मसौदा खंड",
    scoreExplain: "यह विनिर्देश दस्तावेज़ कितना पूर्ण है, निश्चित नियमों से आँका गया — एक ही दस्तावेज़ का स्कोर हमेशा एक ही रहता है। यह कागज़ात मापता है, उत्पाद नहीं।",
    scoreFootnote: "एक निश्चित जाँच-सूची के विरुद्ध नियमबद्ध स्कोर। इसमें कोई AI शामिल नहीं।",
    gradeReady: "तैयार", gradeNeedsWork: "सुधार चाहिए", gradeIncomplete: "अपूर्ण",
    draftButton: "खंडों का मसौदा बनाएँ", draftWorking: "मसौदा बन रहा है…",
    draftHint: "केवल प्राप्त रिकॉर्डों से मानक, प्रमाणन और परीक्षण खंड बनाता है।",
    draftFailed: "मसौदा विफल — क्या API चल रहा है?",
    draftNothing: "वास्तविक मानक क्रमांक वाला कोई रिकॉर्ड नहीं मिला, इसलिए ईमानदारी से कोई खंड नहीं बनाया जा सकता।",
    draftSourceRules: "नियम-निर्मित पाठ", draftSourceModel: "स्थानीय मॉडल द्वारा परिष्कृत",
    draftCopy: "कॉपी करें", draftCopied: "कॉपी हुआ",
    draftFootnote: "इस मसौदे का हर मानक क्रमांक पुनर्प्राप्ति से आया है। गढ़ा गया क्रमांक स्वतः हटा दिया जाता है।",
    whereFrom: "आपकी निविदा में यह कहाँ से आया",
  },
  te: {
    overview: "సమగ్ర వీక్షణ", analyse: "టెండర్ విశ్లేషణ", network: "పరస్పర సంబంధాలు",
    standards: "ప్రమాణాల జాబితా", reports: "నివేదిక డౌన్‌లోడ్", history: "చరిత్ర",
    signOutOfficer: "సరఫరాదారుగా మారండి", signOutSupplier: "అధికారిగా మారండి",
    heroTitle: "ఆధారాలపై నిలిచిన కొనుగోలు నిర్ణయాలు.",
    heroLede: "టెండర్‌ను మీరు సమర్థించగల భారతీయ ప్రమాణాల జాబితాగా మార్చండి — ప్రతి ఒక్కటి అధికారిక మూలానికి అనుసంధానించబడి ఉంటుంది.",
    newTender: "కొత్త టెండర్ విశ్లేషణ", browse: "ప్రమాణాలు చూడండి",
    whatBuying: "మీరు ఏమి కొనుగోలు చేస్తున్నారు?", describe: "కొనుగోలు వివరించండి",
    shortTitle: "సంక్షిప్త శీర్షిక", whatBuyingQ: "మీరు ఏమి కొనుగోలు చేస్తున్నారు?",
    typeIt: "టైప్ చేయండి", uploadFile: "ఫైల్ అప్‌లోడ్ చేయండి", findStandards: "ప్రమాణాలను కనుగొనండి",
    working: "పని జరుగుతోంది…", step1: "దశ 1 / 2", understood: "మేము ఇలా అర్థం చేసుకున్నాము",
    showStandards: "ఇప్పుడు ప్రమాణాలు చూపండి", thatsWrong: "ఇది తప్పు — సవరించనివ్వండి",
    tabResults: "దొరికిన ప్రమాణాలు", tabRead: "మేము చదివినది", tabGaps: "సరిచేయవలసినవి",
    briefing: "సరళ భాషలో సారాంశం", decision: "మీ నిర్ణయం", approve: "ఆమోదించండి",
    readAs: "ఈ భాషలో చదవబడింది", searchPlaceholder: "పేరుతో ప్రమాణాలను వెతకండి…",
    startNew: "కొత్త విశ్లేషణ ప్రారంభించండి", verified: "ధృవీకరించబడింది",
    checking: "తనిఖీ అవసరం", example: "ఉదాహరణ మాత్రమే",
    analytics: "విశ్లేషణలు",
    statCatalogue: "జాబితాలోని ప్రమాణాలు", statCatalogueNote: "అధికారిక BIS జాబితా సేవ నుండి సేకరించబడ్డాయి.",
    statTenders: "విశ్లేషించిన టెండర్లు", statTendersNote: "ప్రతి విశ్లేషణ చరిత్రలో భద్రంగా ఉంటుంది.",
    statInvented: "కల్పించిన ప్రమాణ సంఖ్యలు", statInventedNote: "సంఖ్యలు జాబితా నుండే వస్తాయి. AI వాటిని రాయలేదు.",
    statExpiring: "180 రోజుల్లో చెల్లుబాటు ముగుస్తుంది", statExpiringNote: "అధికారిక BIS చెల్లుబాటు తేదీలు, స్వయంచాలకంగా తనిఖీ.",
    evidenceMix: "ఆధారాల స్థితి", evidenceMixLede: "ప్రతి రికార్డు తన స్థాయిని చూపుతుంది. ఏదీ వాస్తవం కంటే ఎక్కువ ఖచ్చితంగా చూపబడదు.",
    topStandards: "అత్యధికంగా ఆధారపడిన ప్రమాణాలు", topStandardsLede: "ఈ వ్యవస్థలో భద్రపరచిన అన్ని విశ్లేషణలలో.",
    langMix: "భాష వారీగా టెండర్లు", langMixLede: "టెండర్ వచ్చిన భాషలోనే విశ్లేషణ జరిగింది.",
    topSectors: "జాబితాలో అతిపెద్ద BIS రంగాలు",
    watchTitle: "చెల్లుబాటు పర్యవేక్షణ", watchLede: "మీ విశ్లేషణలు ఆధారపడిన ప్రమాణాలలో శ్రద్ధ అవసరమైనవి — భర్తీ అయినవి, నిర్ధారించనివి, లేదా చెల్లుబాటు ముగింపుకు చేరువైనవి.",
    watchClear: "దేనికీ శ్రద్ధ అవసరం లేదు. వాడుకలో ఉన్న ప్రతి ప్రమాణం ప్రస్తుతమే.",
    watchStandard: "ప్రమాణం", watchIssue: "సమస్య", watchDetail: "ఏమి చేయాలి",
    tabScore: "స్పెక్ స్కోర్‌కార్డ్", tabDraft: "ముసాయిదా నిబంధనలు",
    scoreExplain: "ఈ వివరణ పత్రం ఎంత పూర్తిగా ఉందో, స్థిర నియమాలతో అంచనా — ఒకే పత్రానికి ఎప్పుడూ ఒకే స్కోరు వస్తుంది. ఇది పత్రాన్ని కొలుస్తుంది, ఉత్పత్తిని కాదు.",
    scoreFootnote: "స్థిర తనిఖీ జాబితాతో నియమబద్ధంగా స్కోరు. ఇందులో AI లేదు.",
    gradeReady: "సిద్ధం", gradeNeedsWork: "మెరుగుదల అవసరం", gradeIncomplete: "అసంపూర్ణం",
    draftButton: "నిబంధనల ముసాయిదా రూపొందించు", draftWorking: "రూపొందుతోంది…",
    draftHint: "పొందిన రికార్డుల నుండే ప్రమాణాలు, ధృవీకరణ, పరీక్ష నిబంధనలను రూపొందిస్తుంది.",
    draftFailed: "ముసాయిదా విఫలమైంది — API నడుస్తోందా?",
    draftNothing: "నిజమైన ప్రమాణ సంఖ్య ఉన్న రికార్డు దొరకలేదు, కాబట్టి నిజాయితీగా నిబంధన రాయలేము.",
    draftSourceRules: "నియమాలతో రూపొందిన పాఠ్యం", draftSourceModel: "స్థానిక మోడల్ మెరుగుపరిచింది",
    draftCopy: "కాపీ", draftCopied: "కాపీ అయింది",
    draftFootnote: "ఈ ముసాయిదాలోని ప్రతి ప్రమాణ సంఖ్య శోధన నుండే వచ్చింది. కల్పించిన సంఖ్యను స్వయంచాలకంగా తొలగిస్తారు.",
    whereFrom: "మీ టెండర్‌లో ఇది ఎక్కడి నుండి వచ్చింది",
  },
  ta: {
    overview: "மொத்தப் பார்வை", analyse: "டெண்டர் பகுப்பாய்வு", network: "தொடர்புகள்",
    standards: "தரநிலைப் பட்டியல்", reports: "அறிக்கை பதிவிறக்கம்", history: "வரலாறு",
    signOutOfficer: "சப்ளையராக மாறு", signOutSupplier: "அலுவலராக மாறு",
    heroTitle: "ஆதாரத்தில் நிலைத்த கொள்முதல் முடிவுகள்.",
    heroLede: "ஒரு டெண்டரை நீங்கள் நியாயப்படுத்தக்கூடிய இந்தியத் தரநிலைகளின் பட்டியலாக மாற்றுங்கள் — ஒவ்வொன்றும் அதிகாரப்பூர்வ மூலத்துடன் இணைக்கப்பட்டது.",
    newTender: "புதிய டெண்டரை பகுப்பாய்வு செய்", browse: "தரநிலைகளைப் பார்",
    whatBuying: "நீங்கள் என்ன வாங்குகிறீர்கள்?", describe: "கொள்முதலை விவரியுங்கள்",
    shortTitle: "சுருக்கமான தலைப்பு", whatBuyingQ: "நீங்கள் என்ன வாங்குகிறீர்கள்?",
    typeIt: "தட்டச்சு செய்", uploadFile: "கோப்பைப் பதிவேற்று", findStandards: "தரநிலைகளைக் கண்டறி",
    working: "செயலில் உள்ளது…", step1: "படி 1 / 2", understood: "நாங்கள் புரிந்துகொண்டது இதுதான்",
    showStandards: "இப்போது தரநிலைகளைக் காட்டு", thatsWrong: "இது தவறு — திருத்த அனுமதி",
    tabResults: "கிடைத்த தரநிலைகள்", tabRead: "நாங்கள் படித்தது", tabGaps: "சரிசெய்ய வேண்டியவை",
    briefing: "எளிய மொழியில் சுருக்கம்", decision: "உங்கள் முடிவு", approve: "ஒப்புதல் அளி",
    readAs: "இந்த மொழியில் படிக்கப்பட்டது", searchPlaceholder: "பெயரால் தரநிலைகளைத் தேடு…",
    startNew: "புதிய பகுப்பாய்வைத் தொடங்கு", verified: "சரிபார்க்கப்பட்டது",
    checking: "சரிபார்ப்பு தேவை", example: "எடுத்துக்காட்டு மட்டும்",
    analytics: "பகுப்பாய்வுகள்",
    statCatalogue: "பட்டியலில் உள்ள தரநிலைகள்", statCatalogueNote: "அதிகாரப்பூர்வ BIS பட்டியல் சேவையிலிருந்து பெறப்பட்டவை.",
    statTenders: "பகுப்பாய்வு செய்த டெண்டர்கள்", statTendersNote: "ஒவ்வொரு பகுப்பாய்வும் வரலாற்றில் பாதுகாக்கப்படுகிறது.",
    statInvented: "கற்பனை தரநிலை எண்கள்", statInventedNote: "எண்கள் பட்டியலிலிருந்தே வரும். AI அவற்றை எழுத முடியாது.",
    statExpiring: "180 நாட்களில் செல்லுபடி முடிவு", statExpiringNote: "அதிகாரப்பூர்வ BIS செல்லுபடி தேதிகள், தானாகச் சரிபார்க்கப்பட்டவை.",
    evidenceMix: "ஆதாரங்களின் நிலை", evidenceMixLede: "ஒவ்வொரு பதிவும் தன் நிலையைக் காட்டுகிறது. எதுவும் உண்மையை விட உறுதியாகக் காட்டப்படாது.",
    topStandards: "அதிகம் நம்பப்பட்ட தரநிலைகள்", topStandardsLede: "இந்த அமைப்பில் சேமித்த எல்லா பகுப்பாய்வுகளிலும்.",
    langMix: "மொழி வாரியாக டெண்டர்கள்", langMixLede: "டெண்டர் வந்த மொழியிலேயே பகுப்பாய்வு நடந்தது.",
    topSectors: "பட்டியலின் பெரிய BIS துறைகள்",
    watchTitle: "செல்லுபடி கண்காணிப்பு", watchLede: "உங்கள் பகுப்பாய்வுகள் சார்ந்த தரநிலைகளில் கவனம் தேவையானவை — மாற்றப்பட்டவை, உறுதிப்படுத்தாதவை, அல்லது செல்லுபடி முடிவை நெருங்குபவை.",
    watchClear: "எதற்கும் கவனம் தேவையில்லை. பயன்பாட்டில் உள்ள ஒவ்வொரு தரநிலையும் நடப்பில் உள்ளது.",
    watchStandard: "தரநிலை", watchIssue: "சிக்கல்", watchDetail: "என்ன செய்வது",
    tabScore: "விவரக்குறிப்பு மதிப்பீடு", tabDraft: "வரைவு பிரிவுகள்",
    scoreExplain: "இந்த விவரக்குறிப்பு ஆவணம் எவ்வளவு முழுமையானது, நிலையான விதிகளால் மதிப்பிடப்பட்டது — ஒரே ஆவணத்திற்கு எப்போதும் ஒரே மதிப்பெண். இது ஆவணத்தை அளக்கிறது, பொருளை அல்ல.",
    scoreFootnote: "நிலையான சரிபார்ப்புப் பட்டியலுக்கு எதிராக விதிமுறையாக மதிப்பிடப்பட்டது. இதில் AI இல்லை.",
    gradeReady: "தயார்", gradeNeedsWork: "மேம்பாடு தேவை", gradeIncomplete: "முழுமையற்றது",
    draftButton: "பிரிவுகளை வரைவு செய்", draftWorking: "வரைவாகிறது…",
    draftHint: "பெறப்பட்ட பதிவுகளிலிருந்து மட்டுமே தரநிலை, சான்றிதழ், சோதனை பிரிவுகளை உருவாக்கும்.",
    draftFailed: "வரைவு தோல்வி — API இயங்குகிறதா?",
    draftNothing: "உண்மையான தரநிலை எண் உள்ள பதிவு கிடைக்கவில்லை, எனவே நேர்மையாக பிரிவு எழுத முடியாது.",
    draftSourceRules: "விதிகளால் உருவான உரை", draftSourceModel: "உள்ளூர் மாடலால் மெருகூட்டப்பட்டது",
    draftCopy: "நகலெடு", draftCopied: "நகலானது",
    draftFootnote: "இந்த வரைவின் ஒவ்வொரு தரநிலை எண்ணும் தேடலில் இருந்தே வந்தது. கற்பனை எண் தானாக நீக்கப்படும்.",
    whereFrom: "உங்கள் டெண்டரில் இது எங்கிருந்து வந்தது",
  },
};

const LANGUAGE_NAME: Record<string, string> = { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil" };

function confidenceWord(level: string): string {
  return { high: "Strong match", medium: "Likely match", low: "Weak match" }[level] ?? level;
}

/* ---------------------------------------------------------------------
   Small presentational pieces
   --------------------------------------------------------------------- */

function Identifier({ standard }: { standard: ApiStandard }) {
  const tier = tierOf(standard);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`ident ${tier === "example" ? "internal" : "real"}`}>
        {standard.standard_number ?? standard.catalogue_ref ?? "No reference"}
      </span>
      <span className={`tag ${TIER_CLASS[tier]}`}>{TIER_LABEL[tier]}</span>
    </span>
  );
}

function Stat({ value, caption, note, tone }: { value: string; caption: string; note?: string; tone?: "rust" | "green" }) {
  return (
    <div className="stat">
      <div className={`num ${tone ?? ""}`}>{value}</div>
      <div className="cap">{caption}</div>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

function Stepper({ analysis, running }: { analysis: AnalysisResult | null; running: boolean }) {
  const done = Boolean(analysis);
  const steps = [
    { label: "Tender read", done, active: running },
    { label: "Details pulled out", done: done && analysis!.extracted_requirements.length > 0, active: running },
    { label: "Standards searched", done: done && analysis!.recommendations.length > 0, active: running },
    { label: "Your decision", done: false, active: done },
  ];
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s.label} className={`step ${s.done ? "done" : s.active ? "active" : ""}`}>
          <span className="step-dot">{s.done ? <Check size={13} /> : i + 1}</span>
          <span className="step-label">{s.label}</span>
          {i < steps.length - 1 && <span className="step-line" />}
        </div>
      ))}
    </div>
  );
}

/** One result, collapsed. Everything else lives in the detail panel. */
function ResultRow({ item, onOpen }: { item: ApiRecommendation; onOpen: () => void }) {
  const pct = Math.round(item.confidence_score * 100);
  const ringClass = item.confidence_level === "high" ? "hi" : item.confidence_level === "medium" ? "mid" : "lo";
  const relation = plainRelation(item.relation_note);
  return (
    <button className={`result ${item.standard_type === "primary" ? "primary" : ""}`} onClick={onOpen}>
      <span className={`ring ${ringClass}`}>{pct}%</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Identifier standard={item.standard} />
          <span className="tag rust">{plainRole(item.standard_type)}</span>
          {item.certification_required && <span className="tag red">BIS mark required</span>}
          {item.is_outdated && <span className="tag red">Out of date</span>}
        </span>
        <h4>{item.standard.official_title}</h4>
        <p className="sub">{relation ?? confidenceWord(item.confidence_level)} · Tap to see why</p>
      </span>
      <ChevronRight size={18} className="text-[var(--faint)]" />
    </button>
  );
}

/** The drill-down. Everything about one result, in one place. */
function HighlightedSpan({ text, terms }: { text: string; terms: string[] }) {
  // Split on the matched terms and wrap them, so the officer sees at a glance
  // which of their own words carried the match. Pure string work on the span
  // the backend located in the stored document -- nothing is paraphrased.
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        terms.some(term => part.toLowerCase() === term.toLowerCase())
          ? <mark key={index}>{part}</mark>
          : <span key={index}>{part}</span>
      )}
    </>
  );
}

function DetailPanel({ item, onClose }: { item: ApiRecommendation; onClose: () => void }) {
  const tier = tierOf(item.standard);
  const relation = plainRelation(item.relation_note);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Standard details">
        <header className="panel-head">
          <div className="min-w-0">
            <Identifier standard={item.standard} />
            <h2 className="mt-2 text-[19px] leading-snug">{item.standard.official_title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="panel-body">
          <div className={`notice ${tier === "verified" ? "green" : tier === "checking" ? "amber" : "plain"}`}>
            {tier === "verified" ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
            <span><strong>{TIER_LABEL[tier]}.</strong> {TIER_MEANING[tier]}</span>
          </div>

          {item.is_outdated && (
            <div className="notice red mt-3">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span><strong>This one is out of date.</strong> {item.currency_warning}</span>
            </div>
          )}

          <dl className="mt-2">
            <div className="field">
              <dt>How well it matches</dt>
              <dd>{Math.round(item.confidence_score * 100)}% — {confidenceWord(item.confidence_level)}</dd>
            </div>
            {item.evidence_spans && item.evidence_spans.length > 0 && (
              <div className="field">
                <dt>Where this comes from in your tender</dt>
                <dd>
                  {item.evidence_spans.map(span => (
                    <blockquote className="evidence-quote" key={span.start}>
                      <HighlightedSpan text={span.text} terms={span.terms} />
                      <div className="evidence-terms">matched: {span.terms.join(", ")}</div>
                    </blockquote>
                  ))}
                </dd>
              </div>
            )}
            <div className="field">
              <dt>Why it came up</dt>
              <dd>{relation ? `${relation}. It was included because the main standard depends on it, not because of how the tender is worded.` : item.reason_for_recommendation}</dd>
            </div>
            {item.matched_requirements.length > 0 && (
              <div className="field">
                <dt>Words it matched in your tender</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {item.matched_requirements.map(w => <span className="tag grey" key={w}>{w}</span>)}
                </dd>
              </div>
            )}
            <div className="field">
              <dt>Is a BIS mark required?</dt>
              <dd>
                {item.certification_required
                  ? <><strong>Yes.</strong> Required under {item.qco_title}{item.qco_enforcement_date ? `, in force since ${item.qco_enforcement_date}` : ""}.</>
                  : "Not confirmed. We only say yes when an officially checked order says so."}
              </dd>
            </div>
            {item.amendments.length > 0 && (
              <div className="field">
                <dt>Changes since it was published</dt>
                <dd>
                  <ul className="m-0 list-disc pl-4">
                    {item.amendments.map(a => (
                      <li key={a.amendment_number} className="mb-1">
                        <strong>{a.amendment_number}</strong>{a.issued_date ? ` (${a.issued_date})` : ""}{a.summary ? ` — ${a.summary}` : ""}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="field">
              <dt>What it covers</dt>
              <dd>{item.standard.scope_summary || "No summary recorded."}</dd>
            </div>
            <div className="field">
              <dt>Last checked by a person</dt>
              <dd>{item.standard.last_checked_date ?? "Not yet checked"}</dd>
            </div>
          </dl>
        </div>

        <footer className="panel-foot flex gap-9">
          {item.standard.official_source_url ? (
            <a className="btn btn-primary flex-1" href={item.standard.official_source_url} target="_blank" rel="noopener noreferrer">
              <Link2 size={15} /> Open the official page
            </a>
          ) : (
            <span className="notice plain flex-1">No official page — this is an example record.</span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </>
  );
}


/* ---------------------------------------------------------------------
   Standards network — drawn from the same relationship edges retrieval
   uses, so the picture can never show a link the database does not hold.
   --------------------------------------------------------------------- */

const NODE_COLOUR: Record<string, string> = {
  centre: "#b4522e",
  standard: "#2f7a52",
  test: "#3c6c9e",
  safety: "#6a6a96",
  regulatory: "#b08a30",
  revision: "#b08a30",
};

const LEGEND: Array<[string, string]> = [
  ["#b4522e", "The record you picked"],
  ["#2f7a52", "Checked official record"],
  ["#3c6c9e", "Testing record"],
  ["#6a6a96", "Marking or definitions"],
  ["#b08a30", "Rule or older version"],
];

/** Break a title into at most two short lines rather than truncating it. */
function wrapTitle(title: string, perLine = 20): string[] {
  const words = title.replace(/\s*\(demonstration record\)\s*/i, "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > perLine) {
      if (lines.length === 1) { lines.push(`${line}…`); return lines; }
      lines.push(line.trim()); line = word;
    } else line = `${line} ${word}`;
  }
  if (line.trim() && lines.length < 2) lines.push(line.trim());
  return lines;
}

/** A small glyph per node type, so the shapes are distinguishable at a glance. */
function NodeGlyph({ kind, x, y, colour }: { kind: string; x: number; y: number; colour: string }) {
  const common = { stroke: colour, strokeWidth: 1.8, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "test") {
    return <g transform={`translate(${x - 7},${y - 7})`}><path d="M5 1v4.5L1.5 12a1.5 1.5 0 0 0 1.3 2.2h8.4A1.5 1.5 0 0 0 12.5 12L9 5.5V1" {...common} /><path d="M3.5 1h7" {...common} /></g>;
  }
  if (kind === "regulatory") {
    return <g transform={`translate(${x - 7},${y - 7})`}><path d="M2 13h10M7 13V5M3 5h8l-1.5-3h-5z" {...common} /></g>;
  }
  if (kind === "revision") {
    return <g transform={`translate(${x - 7},${y - 7})`}><path d="M12.5 7a5.5 5.5 0 1 1-1.8-4" {...common} /><path d="M11 1v3.2H7.8" {...common} /></g>;
  }
  if (kind === "terminology") {
    // An open book: definitions, not protections. Sharing the safety shield made
    // two different relationships look identical on the diagram.
    return <g transform={`translate(${x - 7},${y - 7})`}><path d="M7 2.5C5.8 1.6 4 1.2 1.5 1.2v10.6c2.5 0 4.3.4 5.5 1.3 1.2-.9 3-1.3 5.5-1.3V1.2C10 1.2 8.2 1.6 7 2.5z" {...common} /><path d="M7 2.5v10.6" {...common} /></g>;
  }
  if (kind === "safety") {
    return <g transform={`translate(${x - 7},${y - 7})`}><path d="M7 1l5 2v4.5c0 3.2-2.1 5.4-5 6.3-2.9-.9-5-3.1-5-6.3V3z" {...common} /></g>;
  }
  return <g transform={`translate(${x - 7},${y - 7})`}><path d="M3 1h5l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" {...common} /><path d="M8 1v3h3" {...common} /></g>;
}

function NetworkGraph({ data, onPick }: { data: StandardNetwork; onPick: (id: string) => void }) {
  const W = 940, H = 520, cx = W / 2, cy = H / 2 - 10;
  const centre = data.nodes.find(n => n.is_centre);
  const others = data.nodes.filter(n => !n.is_centre);

  // Position by meaning rather than by index: what the standard depends on sits
  // to the right, what governs it to the left, other versions of it above and
  // below. The arrangement is deterministic, so the picture never reshuffles.
  const RIGHT = ["test", "safety", "terminology"];
  const LEFT = ["regulatory"];
  const right = others.filter(n => RIGHT.includes(n.kind));
  const left = others.filter(n => LEFT.includes(n.kind));
  const vertical = others.filter(n => !RIGHT.includes(n.kind) && !LEFT.includes(n.kind));

  const positions: Record<string, { x: number; y: number }> = {};
  if (centre) positions[centre.id] = { x: cx, y: cy };

  // Returns one offset per node. Zero nodes must yield no offsets: returning a
  // single offset for an empty group made the caller read element [0] of an
  // empty list and crash the page, which is why the diagram only worked for
  // records that happened to have both test and safety links.
  const spread = (count: number, span: number) =>
    count <= 0 ? [] : count === 1 ? [0] : Array.from({ length: count }, (_, i) => -span / 2 + (i * span) / (count - 1));

  spread(right.length, Math.min(right.length * 132, 300)).forEach((dy, i) => {
    positions[right[i].id] = { x: cx + 300, y: cy + dy };
  });
  spread(left.length, Math.min(left.length * 132, 260)).forEach((dy, i) => {
    positions[left[i].id] = { x: cx - 300, y: cy + dy };
  });
  vertical.forEach((n, i) => {
    positions[n.id] = { x: cx + (i % 2 === 0 ? -128 : 128), y: i % 2 === 0 ? cy + 178 : cy - 178 };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="How this standard connects to other records">
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#bdb5a6" />
        </marker>
      </defs>

      {data.edges.map((e, i) => {
        const a = positions[e.source], b = positions[e.target];
        if (!a || !b) return null;
        // Stop the line at the node edge so the arrowhead is not hidden under it.
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const startR = data.nodes.find(n => n.id === e.source)?.is_centre ? 46 : 32;
        const endR = data.nodes.find(n => n.id === e.target)?.is_centre ? 46 : 32;
        const x1 = a.x + (dx / len) * startR, y1 = a.y + (dy / len) * startR;
        const x2 = b.x - (dx / len) * (endR + 7), y2 = b.y - (dy / len) * (endR + 7);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const width = e.label.length * 5.4 + 14;
        return (
          <g key={`${e.source}-${e.target}-${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={e.dashed ? "#d3ccbe" : "#bdb5a6"} strokeWidth="1.5"
              strokeDasharray={e.dashed ? "5 4" : undefined} markerEnd="url(#arw)" />
            {/* A pill behind the label keeps it readable where it crosses the line. */}
            <rect x={mx - width / 2} y={my - 9} width={width} height="17" rx="8.5" fill="#fbf9f6" stroke="#eae5da" strokeWidth="0.8" />
            <text className="net-edge-label" x={mx} y={my + 2.5} textAnchor="middle">{e.label}</text>
          </g>
        );
      })}

      {data.nodes.map(n => {
        const pos = positions[n.id];
        if (!pos) return null;
        const colour = n.is_centre ? NODE_COLOUR.centre : (NODE_COLOUR[n.kind] ?? NODE_COLOUR.standard);
        const r = n.is_centre ? 44 : 30;
        const lines = wrapTitle(n.label);
        return (
          <g key={n.id} className="net-node" onClick={() => onPick(n.id)}>
            {n.is_centre && <circle cx={pos.x} cy={pos.y} r={r + 11} fill={colour} opacity="0.1" />}
            <circle cx={pos.x} cy={pos.y} r={r} fill="#fff" stroke={colour} strokeWidth={n.is_centre ? 2.6 : 2} />
            <circle cx={pos.x} cy={pos.y} r={r - 5} fill={colour} opacity={n.tier === "example" ? 0.1 : 0.14} />
            <NodeGlyph kind={n.is_centre ? "standard" : n.kind} x={pos.x} y={pos.y} colour={colour} />
            <text className="net-ident" x={pos.x} y={pos.y + r + 16} textAnchor="middle">{n.identifier ?? ""}</text>
            {lines.map((line, li) => (
              <text className="net-label" key={li} x={pos.x} y={pos.y + r + 28 + li * 11} textAnchor="middle">{line}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** The tender text, with the words that drove the match highlighted. */
function DocumentPreview({ text, terms }: { text: string; terms: string[] }) {
  if (!text.trim()) {
    return <div className="doc-empty"><FileText size={26} /><strong className="serif">Nothing to show</strong><span className="text-[12px]">This tender was submitted without readable text.</span></div>;
  }
  const unique = Array.from(new Set(terms.filter(t => t.length > 3))).slice(0, 12);
  // Terms come from tender text, so they must be escaped before becoming a pattern.
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = unique.length ? new RegExp(`(${unique.map(escape).join("|")})`, "gi") : null;
  const parts = pattern ? text.split(pattern) : [text];
  return (
    <div className="doc-page">
      {parts.map((part, i) =>
        pattern && unique.some(t => t.toLowerCase() === part.toLowerCase())
          ? <mark key={i}>{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </div>
  );
}


/* ---------------------------------------------------------------------
   Page
   --------------------------------------------------------------------- */

export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [credentials, setCredentials] = useState({ email: "officer@manaksetu.gov.in", password: "ManakSetu@2026" });

  const [view, setView] = useState<View>("overview");
  // Interface language. Remembered per browser; the tender itself is still read
  // in whatever language it was actually written in.
  const [uiLang, setUiLang] = useState<UiLang>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("manaksetu_ui_lang") as UiLang | null;
      if (saved && UI_LANGS.some(l => l.code === saved)) setUiLang(saved);
    } catch { /* private window: English is a fine default */ }
  }, []);
  const t = (key: string) => T[uiLang][key] ?? T.en[key] ?? key;
  const chooseLang = (code: UiLang) => {
    setUiLang(code);
    try { window.localStorage.setItem("manaksetu_ui_lang", code); } catch { /* ignore */ }
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [openResult, setOpenResult] = useState<ApiRecommendation | null>(null);
  const [tab, setTab] = useState<"results" | "details" | "gaps" | "draft">("results");
  // After an analysis the officer is shown what was understood before what was
  // found. Dumping every result at once gave them no way to catch a
  // misreading of their own tender before acting on it.
  const [stage, setStage] = useState<"review" | "results">("results");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "Construction safety helmets",
    description: "Purchase 1,000 industrial safety helmet units for construction workers with impact testing and permanent marking.",
    language: "en",
  });

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [standards, setStandards] = useState<ApiStandard[]>([]);
  const [standardsQuery, setStandardsQuery] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [network, setNetwork] = useState<StandardNetwork | null>(null);
  const [networkOf, setNetworkOf] = useState<ApiStandard | null>(null);
  // Set only when the officer chooses a record explicitly; otherwise the
  // diagram tracks whatever they last analysed.
  const [pinnedRecord, setPinnedRecord] = useState<ApiStandard | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [approved, setApproved] = useState(false);

  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 3000); };
  const can = (p: string) => Boolean(user?.permissions?.includes(p));

  useEffect(() => {
    // Open straight into the workspace. Authentication is still enforced on
    // every request -- this signs in with the demonstration officer rather than
    // asking for credentials that are printed on the screen anyway. If those
    // accounts are not seeded, the sign-in form appears as before.
    getCurrentUser()
      .then(setUser)
      .catch(() =>
        loginUser(DEMO_OFFICER.email, DEMO_OFFICER.password)
          .then(setUser)
          .catch(() => setUser(null)),
      )
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    getLatestAnalysis().then(r => r && setAnalysis(r)).catch(() => undefined);
    getDashboardStats().then(setStats).catch(() => undefined);
    getCategories().then(setCategories).catch(() => undefined);
  }, [user]);

  // The written summary is slow, so it is fetched after results are on screen.
  const tenderId = analysis?.tender?.id;
  const briefingPending = analysis?.officer_summary_status === "pending";
  useEffect(() => {
    if (!tenderId || !briefingPending) return;
    let cancelled = false;
    getBriefing(tenderId)
      .then(b => { if (!cancelled) setAnalysis(c => (c && c.tender.id === tenderId ? { ...c, ...b } : c)); })
      .catch(() => { if (!cancelled) setAnalysis(c => (c && c.tender.id === tenderId ? { ...c, officer_summary_status: "unavailable" } : c)); });
    return () => { cancelled = true; };
  }, [tenderId, briefingPending]);

  useEffect(() => {
    if (!user) return;
    if (view === "standards") getStandards(standardsQuery).then(setStandards).catch(() => notify("Could not load the standards list"));
    if (view === "audit" && can(PERMISSIONS.auditRead)) getAuditHistory().then(setAudit).catch(() => notify("Could not load the history"));
    if (view === "overview") getDashboardStats().then(setStats).catch(() => undefined);
    if (view === "network") {
      // Follow the current analysis unless the officer pinned a record by hand.
      // Previously the first record it ever showed stuck forever, so analysing
      // something new left the diagram on the old subject.
      const seed = pinnedRecord ?? analysis?.recommendations[0]?.standard ?? null;
      if (seed) {
        setNetworkOf(seed);
        getNetwork(seed.id).then(setNetwork).catch(() => notify("Could not draw the connections"));
      } else {
        getStandards().then(list => {
          const first = list.find(s => s.verification_status === "verified") ?? list[0];
          if (first) { setNetworkOf(first); getNetwork(first.id).then(setNetwork).catch(() => undefined); }
        }).catch(() => undefined);
      }
    }
  }, [view, user, standardsQuery, pinnedRecord, analysis?.tender?.id]);

  const showNetworkFor = (standard: ApiStandard) => {
    setPinnedRecord(standard);
    setNetworkOf(standard);
    setNetwork(null);
    setView("network");
    getNetwork(standard.id).then(setNetwork).catch(() => notify("Could not draw the connections"));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true); setLoginError("");
    try { setUser(await loginUser(credentials.email, credentials.password)); }
    catch (err) { setLoginError(err instanceof Error ? err.message : "Could not sign in"); }
    finally { setSigningIn(false); }
  };

  /** Clear the previous analysis so the officer starts from a blank form. */
  const startNewAnalysis = () => {
    setAnalysis(null);
    setOpenResult(null);
    setPinnedRecord(null);
    setNetwork(null);
    setNetworkOf(null);
    setApproved(false);
    setReviewNote("");
    setFormError("");
    setFile(null);
    setStage("results");
    setForm({ title: "", description: "", language: "en" });
    setView("analyse");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const runAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setFormError("");
    try {
      const result = mode === "file" && file ? await analyseFile(file) : await analyseTender(form);
      setAnalysis(result); setApproved(false); setTab("results"); setStage("review"); setView("analyse");
      notify(result.recommendations.length ? `Found ${result.recommendations.length} possible standards` : "No matching standards found");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not analyse that. Please try again.");
    } finally { setSubmitting(false); }
  };

  const approve = async () => {
    if (!analysis) return;
    try { await saveReview(analysis.tender.id, "approved", reviewNote); setApproved(true); notify("Decision recorded"); }
    catch { notify("Could not save your decision"); }
  };

  const exportReport = async (fmt: "pdf" | "docx" | "xlsx" | "json") => {
    if (!analysis) { notify("Run an analysis first"); return; }
    try { await downloadReport(analysis.tender.id, fmt); notify(`${fmt.toUpperCase()} downloaded`); }
    catch { notify("Could not create the file"); }
  };

  if (authLoading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="grid justify-items-center gap-3 text-[var(--muted)]">
          <LoaderCircle className="spin" size={22} />
          <p className="text-xs">Opening your workspace…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login">
        <section className="login-art">
          <div>
            <p className="eyebrow" style={{ color: "#e3a882" }}>ManakSetu</p>
            <h2 className="mt-4">The right standards,<br />backed by evidence.</h2>
            <p>Describe what you are buying. We find the Indian Standards that apply, show you where each one came from, and leave the final call to you.</p>
          </div>
          <p className="text-[10px] uppercase tracking-[.16em] text-white/30">Right specifications. A stronger India.</p>
        </section>
        <section className="login-form">
          <div className="login-inner">
            <div className="mb-6 grid h-12 w-12 place-items-center rounded-xl bg-[var(--navy)] text-white"><LockKeyhole size={20} /></div>
            <h3>Sign in</h3>
            <p className="mb-6 text-[13px] text-[var(--muted)]">Use your official email address.</p>
            <form onSubmit={handleLogin}>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" value={credentials.email} onChange={e => setCredentials({ ...credentials, email: e.target.value })} required />
              <div className="h-4" />
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} required />
              {loginError && <p className="mt-3 text-[12px] text-[var(--red)]">{loginError}</p>}
              <button className="btn btn-primary mt-5 w-full" type="submit" disabled={signingIn}>
                {signingIn ? <><LoaderCircle className="spin" size={15} /> Signing in…</> : <><LockKeyhole size={15} /> Sign in</>}
              </button>
            </form>
            <div className="notice plain mt-5">
              <Sparkles size={15} className="mt-0.5 shrink-0" />
              <span>Demonstration login is already filled in. A second account, <strong>supplier@example.in</strong>, shows what a supplier can and cannot do.</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const recs = analysis?.recommendations ?? [];
  const gaps = analysis?.missing_requirements ?? [];
  const details = analysis?.extracted_requirements ?? [];
  const product = details.find(d => d.requirement_type === "product");
  const verifiedCount = stats?.verified_standards ?? 0;
  const totalCount = stats?.total_standards ?? 0;
  const sourceText = analysis?.tender?.source_text ?? "";
  // Highlight the words that actually drove a match, so the officer can see the
  // link between their wording and the results rather than taking it on trust.
  const highlightTerms = Array.from(new Set(recs.flatMap(r => r.matched_requirements)));

  const nav: Array<{ id: View; label: string; icon: React.ElementType; show: boolean; count?: number }> = [
    { id: "overview", label: t("overview"), icon: LayoutDashboard, show: true },
    { id: "analyse", label: t("analyse"), icon: FileSearch, show: true, count: recs.length || undefined },
    { id: "network", label: t("network"), icon: Share2, show: true },
    { id: "standards", label: t("standards"), icon: BookOpenCheck, show: true },
    { id: "analytics", label: t("analytics"), icon: BarChart3, show: true },
    { id: "reports", label: t("reports"), icon: FileCheck2, show: can(PERMISSIONS.reportExport) },
    { id: "audit", label: t("history"), icon: History, show: can(PERMISSIONS.auditRead) },
  ];

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <h1>ManakSetu</h1>
          <span>Verified standards intelligence</span>
        </div>
        <nav className="nav">
          {nav.filter(n => n.show).map(n => (
            <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => { setView(n.id); setSidebarOpen(false); }}>
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.count ? <span className="nav-count">{n.count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="tagline">Standards<br />for a safer<br />tomorrow</p>
          <button className="who" onClick={() => notify(`Signed in as ${user.full_name}`)}>
            <span className="avatar">{user.full_name.split(" ").map(p => p[0]).join("").slice(0, 2)}</span>
            <span className="min-w-0 flex-1">
              <strong className="truncate">{user.full_name}</strong>
              <small>{user.role.replaceAll("_", " ")}</small>
            </span>
          </button>
          <button
            className="btn btn-sm mt-2 w-full text-white/60 hover:text-white"
            onClick={async () => {
              const next = user.role === "supplier" ? DEMO_OFFICER : DEMO_SUPPLIER;
              logout();
              try {
                setUser(await loginUser(next.email, next.password));
                startNewAnalysis();
                notify(next === DEMO_SUPPLIER ? "Now signed in as a supplier — review and export are refused" : "Back to the procurement officer");
              } catch { setUser(null); }
            }}
          >
            <LogOut size={14} /> {user.role === "supplier" ? t("signOutSupplier") : t("signOutOfficer")}
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="searchbox">
            <Search size={15} />
            <input
              placeholder={t("searchPlaceholder")}
              value={standardsQuery}
              onChange={e => { setStandardsQuery(e.target.value); if (view !== "standards") setView("standards"); }}
            />
          </div>
          <span className="ml-auto hidden text-[11px] text-[var(--faint)] lg:block">
            {verifiedCount} verified · {totalCount} records
          </span>
          <div className="langbar" role="group" aria-label="Interface language">
            <Globe2 size={14} className="text-[var(--faint)]" />
            {UI_LANGS.map(l => (
              <button
                key={l.code}
                className={uiLang === l.code ? "active" : ""}
                onClick={() => chooseLang(l.code)}
                title={l.native}
                aria-pressed={uiLang === l.code}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>

        <div className="page page-wide">
          {/* ---------------- Overview ---------------- */}
          {view === "overview" && (
            <>
              <p className="eyebrow">Overview</p>
              <h1 className="display mt-3">{t("heroTitle")}</h1>
              <p className="lede">{t("heroLede")}</p>

              <div className="mt-7 flex flex-wrap gap-9">
                {can(PERMISSIONS.tenderCreate) && (
                  <button className="btn btn-primary" onClick={startNewAnalysis}><FileSearch size={16} /> {t("newTender")}</button>
                )}
                <button className="btn btn-ghost" onClick={() => setView("standards")}><BookOpenCheck size={16} /> {t("browse")}</button>
              </div>

              <div className="grid-3 mt-8">
                <Stat value={String(totalCount)} caption="Standards in the catalogue" note={`${verifiedCount} checked by a person; the rest show their source and say they still need checking.`} />
                <Stat value="Zero" caption="Invented standard numbers" tone="green" note="Numbers only ever come from the catalogue. The AI is not allowed to write one." />
                <Stat value={String(stats?.total_tenders ?? 0)} caption="Tenders analysed" tone="rust" note="Every analysis is recorded in the history, with who did what and when." />
              </div>

              <div className="card card-pad mt-6">
                <h3 className="section-head">How this works</h3>
                <p className="section-sub">Four steps, and you decide at the end.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ["1. You describe the purchase", "Type a few lines, or upload the tender document. Scanned pages are read automatically."],
                    ["2. We work out what you need", "The product, where it will be used, quantities, testing and safety requirements."],
                    ["3. We search by meaning", "Not just keywords — 'head protection' finds helmet standards even without the word 'helmet'."],
                    ["4. You check and approve", "Every result shows where it came from. Nothing is final until you say so."],
                  ].map(([h, p]) => (
                    <div key={h} className="rounded-xl border border-[var(--line)] bg-[#fdfcfa] p-4">
                      <strong className="serif text-[14px]">{h}</strong>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{p}</p>
                    </div>
                  ))}
                </div>
              </div>

              {analysis && (
                <div className="card mt-6">
                  <div className="card-head flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">Most recent</p>
                      <h3 className="section-head mt-1 truncate">{analysis.tender.title}</h3>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setView("analyse")}>Open <ArrowRight size={14} /></button>
                  </div>
                  <div className="card-pad grid gap-4 sm:grid-cols-3">
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Product</p><p className="mt-1 font-semibold">{product?.value ?? "Not identified"}</p></div>
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Standards found</p><p className="mt-1 font-semibold">{recs.length}</p></div>
                    <div><p className="cap text-[10px] font-bold uppercase tracking-wider text-[var(--faint)]">Things to fix</p><p className="mt-1 font-semibold">{gaps.length}</p></div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------- Analyse ---------------- */}
          {view === "analyse" && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="eyebrow">Analyse a tender</p>
                  <h1 className="display mt-3">{analysis ? analysis.tender.title : t("whatBuying")}</h1>
                  {analysis && <p className="lede">Reference {analysis.tender.reference} · {new Date(analysis.tender.created_at).toLocaleString()}</p>}
                </div>
                {analysis && can(PERMISSIONS.tenderCreate) && (
                  <button className="btn btn-primary" onClick={startNewAnalysis}>{t("startNew")}</button>
                )}
              </div>

              <div className="card card-pad mt-6"><Stepper analysis={analysis} running={submitting} /></div>

              <div className="grid-2 mt-5">
                <div className="min-w-0">
                  {can(PERMISSIONS.tenderCreate) && (
                    <div className="card card-pad mb-5">
                      <h3 className="section-head">{t("describe")}</h3>
                      <p className="section-sub">A sentence or two is enough. Or upload the tender document.</p>

                      <div className="mt-4 flex gap-9">
                        <button className={`btn btn-sm ${mode === "text" ? "btn-dark" : "btn-ghost"}`} onClick={() => setMode("text")}>{t("typeIt")}</button>
                        <button className={`btn btn-sm ${mode === "file" ? "btn-dark" : "btn-ghost"}`} onClick={() => setMode("file")}>{t("uploadFile")}</button>
                      </div>

                      <form className="mt-4" onSubmit={runAnalysis}>
                        {mode === "text" ? (
                          <>
                            <label className="label" htmlFor="t">Short title</label>
                            <input id="t" className="input" placeholder="e.g. Safety helmets for site workers" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} />
                            <div className="h-4" />
                            <label className="label" htmlFor="d">What are you buying?</label>
                            <textarea id="d" className="textarea" placeholder="Describe what you are buying. A sentence or two is enough — what it is, who will use it, and any testing or certification you need." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required minLength={10} />
                          </>
                        ) : (
                          <label className="dropzone block cursor-pointer">
                            <UploadCloud size={26} className="text-[var(--rust)]" />
                            <strong className="serif text-[14px]">{file ? file.name : "Choose a file"}</strong>
                            <span className="text-[12px]">PDF, Word, Excel, or a photo of a printed page. Scanned pages are read for you.</span>
                            <input type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                          </label>
                        )}
                        {formError && <p className="mt-3 text-[12px] text-[var(--red)]">{formError}</p>}
                        <button className="btn btn-primary mt-4 w-full" type="submit" disabled={submitting || (mode === "file" && !file)}>
                          {submitting ? <><LoaderCircle className="spin" size={15} /> {t("working")}</> : <>{t("findStandards")} <ArrowRight size={15} /></>}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Step one: what we understood, before what we found. */}
                  {analysis && stage === "review" && (
                    <div className="card card-pad">
                      <p className="eyebrow">{t("step1")}</p>
                      <h3 className="section-head mt-2">{t("understood")}</h3>
                      <p className="section-sub">Check this before looking at the standards. If we have read your tender wrongly, the results will be wrong too.</p>

                      <div className="read-as">
                        <span><Globe2 size={14} /> {t("readAs")} <strong>{LANGUAGE_NAME[analysis.tender.language] ?? analysis.tender.language.toUpperCase()}</strong></span>
                        <span><FileText size={14} /> {analysis.tender.filename ? "Uploaded document" : "Typed description"}</span>
                        {analysis.tender.source_text && <span><Search size={14} /> {analysis.tender.source_text.length.toLocaleString()} characters read</span>}
                      </div>

                      <dl className="mt-5">
                        {details.map((d, i) => (
                          <div className="req-line" key={`${d.requirement_type}-${d.value}-${i}`}>
                            <dt>{d.requirement_type.replaceAll("_", " ")}</dt>
                            <dd>{d.value}</dd>
                            {d.needs_confirmation
                              ? <span className="tag amber">We guessed this</span>
                              : <CheckCircle2 size={17} className="text-[var(--green)]" aria-label="Found in your tender" />}
                          </div>
                        ))}
                      </dl>
                      {!details.length && (
                        <div className="notice amber mt-4">
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                          <span>We could not pick out any details. Try describing the purchase in a little more detail — what it is, who will use it, and any testing you need.</span>
                        </div>
                      )}

                      {gaps.length > 0 && (
                        <div className="mt-6">
                          <h4 className="serif text-[15px]">Your tender does not mention</h4>
                          <p className="section-sub mt-1">Adding these makes it harder to dispute later.</p>
                          <div className="mt-3">
                            {gaps.map(g => (
                              <div className="rowcard" key={g}>
                                <span className="ico warn"><TriangleAlert size={16} /></span>
                                <div className="min-w-0 flex-1"><dd className="font-semibold">{g}</dd></div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-6 flex flex-wrap gap-9">
                        <button className="btn btn-primary" onClick={() => setStage("results")}>
                          {t("showStandards")} <ArrowRight size={15} />
                        </button>
                        <button className="btn btn-ghost" onClick={() => { setStage("results"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("thatsWrong")}</button>
                      </div>
                    </div>
                  )}

                  {analysis && stage === "results" && (
                    <div className="card">
                      <div className="tabs">
                        <button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}>{t("tabResults")}<span className="pill">{recs.length}</span></button>
                        <button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>{t("tabRead")}<span className="pill">{details.length}</span></button>
                        <button className={tab === "gaps" ? "active" : ""} onClick={() => setTab("gaps")}>{analysis?.scorecard ? t("tabScore") : t("tabGaps")}<span className="pill">{analysis?.scorecard ? `${analysis.scorecard.score}` : gaps.length}</span></button>
                        <button className={tab === "draft" ? "active" : ""} onClick={() => setTab("draft")}>{t("tabDraft")}</button>
                      </div>

                      <div className="card-pad">
                        {tab === "results" && (
                          <>
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                              <p className="section-sub">Tap any result to see why it came up and where it came from.</p>
                              <button className="btn btn-ghost btn-sm" onClick={() => setStage("review")}>What we understood</button>
                            </div>
                            {recs.map(item => <ResultRow key={item.standard.id} item={item} onOpen={() => setOpenResult(item)} />)}
                            {!recs.length && analysis.nearest_records.length > 0 && (
                              <div className="nearest">
                                <div className="nearest-head">
                                  <TriangleAlert size={17} />
                                  <div>
                                    <strong>No standard in the catalogue covers this purchase.</strong>
                                    <p>Nothing below is a recommendation. These are simply the closest records we hold, shown so you can see how far off they are. Do not put any of them in a tender.</p>
                                  </div>
                                </div>
                                {analysis.nearest_records.map(n => (
                                  <div className="nearest-row" key={n.standard.id}>
                                    <span className="nearest-pct">{Math.round(n.similarity * 100)}%</span>
                                    <span className="min-w-0">
                                      <Identifier standard={n.standard} />
                                      <h4>{n.standard.official_title}</h4>
                                    </span>
                                    <span className="tag grey">Not a match</span>
                                  </div>
                                ))}
                                <p className="nearest-foot">
                                  An expert should review this tender. Adding a new area means importing its BIS records — a data task, not a change to the software.
                                </p>
                              </div>
                            )}

                            {!recs.length && analysis.nearest_records.length === 0 && (
                              <div className="empty">
                                <FileSearch size={26} />
                                <strong>Nothing in the catalogue matches this</strong>
                                <span>
                                  The system will not guess. It only returns a standard it can trace to a record, so
                                  when a purchase falls outside what has been loaded it says so instead.
                                </span>
                                {categories.length > 0 && (
                                  <div className="covers">
                                    <p>What the catalogue covers today</p>
                                    <div>
                                      {categories.map(c => (
                                        <span key={c.name} title={c.description}>{c.name}<em>{c.record_count}</em></span>
                                      ))}
                                    </div>
                                    <small>Adding a new area means importing its BIS records — a data task, not a change to the software.</small>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}

                        {tab === "details" && (
                          <>
                            <p className="section-sub mb-4">On the left is the tender as we read it, with the words that drove the match highlighted. On the right is what we understood. Correct anything that looks wrong before approving.</p>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="doc-frame">
                                <div className="doc-bar">
                                  <FileText size={14} />
                                  <span className="truncate">{analysis.tender.filename ?? "Typed description"}</span>
                                  <span className="ml-auto">{analysis.tender.language.toUpperCase()}</span>
                                </div>
                                <DocumentPreview text={sourceText} terms={highlightTerms} />
                              </div>
                              <div>
                                <dl className="m-0">
                                  {details.map((d, i) => (
                                    <div className="req-line" key={`${d.requirement_type}-${d.value}-${i}`}>
                                      <dt>{d.requirement_type.replaceAll("_", " ")}</dt>
                                      <dd>{d.value}</dd>
                                      {d.needs_confirmation
                                        ? <TriangleAlert size={17} className="text-[var(--amber)]" aria-label="Please confirm" />
                                        : <CheckCircle2 size={17} className="text-[var(--green)]" aria-label="Confident" />}
                                    </div>
                                  ))}
                                </dl>
                                {!details.length && <div className="empty"><strong>Nothing picked up</strong><span>Try describing the purchase in a little more detail.</span></div>}
                                <div className="mt-5 border-t border-[var(--line)] pt-4">
                                  <h4 className="serif text-[16px]">In summary</h4>
                                  <div className="mt-3 flex flex-wrap gap-7">
                                    <span className="summary-figure"><span className="fig">{details.length}</span><span className="text-[12px] leading-tight text-[var(--muted)]">details<br />found</span></span>
                                    <span className="summary-figure"><span className="fig warn">{gaps.length}</span><span className="text-[12px] leading-tight text-[var(--muted)]">things<br />to fix</span></span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        {tab === "gaps" && (
                          analysis?.scorecard ? (
                            <ScorecardPanel card={analysis.scorecard} t={t} />
                          ) : (
                            <>
                              <p className="section-sub mb-4">Your tender does not mention these. Adding them makes it harder to dispute later.</p>
                              {gaps.map(g => (
                                <div className="rowcard" key={g}>
                                  <span className="ico warn"><TriangleAlert size={17} /></span>
                                  <div className="min-w-0 flex-1"><dd className="font-semibold">{g}</dd></div>
                                </div>
                              ))}
                              {!gaps.length && <div className="empty"><strong>Nothing missing</strong><span>Your tender already covers the usual points.</span></div>}
                            </>
                          )
                        )}

                        {tab === "draft" && analysis && (
                          <DraftPanel tenderId={analysis.tender.id} t={t} />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right column */}
                <div className="min-w-0 space-y-5">
                  {analysis && analysis.outdated_citations.length > 0 && (
                    <div className="card card-pad">
                      <h3 className="section-head">Your tender names an old standard</h3>
                      {analysis.outdated_citations.map(c => (
                        <div className="notice red mt-3" key={c.cited_standard}>
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                          <span><strong>{c.cited_standard}</strong> — {c.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis && (
                    <div className="card card-pad">
                      <h3 className="section-head">{t("briefing")}</h3>
                      <p className="section-sub">Written for you from the results on the left.</p>
                      {analysis.officer_summary ? (
                        <>
                          <p className="mt-4 text-[13px] leading-[1.7] text-[var(--muted)]">{analysis.officer_summary}</p>
                          <div className="notice plain mt-4">
                            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                            <span>Written by an AI running on this computer. It can only talk about the results above — if it mentions a standard that was not found, the whole summary is thrown away.</span>
                          </div>
                        </>
                      ) : analysis.officer_summary_status === "pending" ? (
                        <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--faint)]"><LoaderCircle className="spin" size={14} /> Writing…</p>
                      ) : analysis.officer_summary_status.startsWith("rejected") ? (
                        <div className="notice amber mt-4">
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                          <span><strong>A summary was thrown away.</strong> The AI mentioned a standard that was not in the results, so we did not show you any of it. The results themselves are unaffected.</span>
                        </div>
                      ) : (
                        <p className="mt-4 text-[13px] text-[var(--faint)]">Not available right now. The results above do not depend on it.</p>
                      )}
                    </div>
                  )}

                  {analysis && can(PERMISSIONS.reviewSubmit) && (
                    <div className="card card-pad">
                      <h3 className="section-head">{t("decision")}</h3>
                      <p className="section-sub">Nothing is final until you approve it.</p>
                      <textarea className="textarea mt-4" style={{ minHeight: 84 }} placeholder="Add a note (optional)" value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
                      {approved ? (
                        <div className="notice green mt-3"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Approved and recorded in the history.</span></div>
                      ) : (
                        <button className="btn btn-primary mt-3 w-full" onClick={approve}><CheckCircle2 size={16} /> {t("approve")}</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ---------------- How they connect ---------------- */}
          {view === "network" && (
            <>
              <p className="eyebrow">How they connect</p>
              <h1 className="display mt-3">One standard rarely stands alone</h1>
              <p className="lede">Most standards depend on others — a test method, a marking rule, a legal order. This shows those links for whichever record you pick.</p>

              {networkOf && (
                <div className="card card-pad mt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Identifier standard={networkOf} />
                      <h3 className="section-head mt-2">{networkOf.official_title}</h3>
                    </div>
                    <div className="flex gap-9">
                      {pinnedRecord && <button className="btn btn-ghost btn-sm" onClick={() => { setPinnedRecord(null); setView("network"); }}>Back to my tender</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setView("standards")}>Pick another <ArrowRight size={14} /></button>
                    </div>
                  </div>
                </div>
              )}

              <div className="card mt-5 overflow-hidden">
                {network ? (
                  <>
                    <div className="net-wrap">
                      <div className="net-canvas">
                        <NetworkGraph data={network} onPick={() => notify("Pick a record from the standards list to centre it")} />
                      </div>
                      <div className="net-side">
                        <p className="eyebrow">This record</p>
                        <h3 className="section-head mt-2">What we know</h3>
                        <div className="mt-3">
                          <div className={`check-row ${network.official_source_verified ? "" : "off"}`}>
                            {network.official_source_verified ? <CheckCircle2 size={16} className="text-[var(--green)]" /> : <Clock3 size={16} />}
                            {network.official_source_verified ? "Official source checked" : "Official source not yet checked"}
                          </div>
                          <div className={`check-row ${network.current_version_confirmed ? "" : "off"}`}>
                            {network.current_version_confirmed ? <CheckCircle2 size={16} className="text-[var(--green)]" /> : <TriangleAlert size={16} className="text-[var(--amber)]" />}
                            {network.current_version_confirmed ? "This is the current version" : "Version not confirmed"}
                          </div>
                          <div className="check-row"><Link2 size={16} className="text-[var(--muted)]" /> {network.linked_standards} linked record{network.linked_standards === 1 ? "" : "s"}</div>
                          <div className="check-row"><FileText size={16} className="text-[var(--muted)]" /> {network.edges.length} connection{network.edges.length === 1 ? "" : "s"} drawn</div>
                        </div>
                        {networkOf?.official_source_url && (
                          <a className="btn btn-primary mt-4 w-full" href={networkOf.official_source_url} target="_blank" rel="noopener noreferrer">
                            <Link2 size={15} /> Open the official page
                          </a>
                        )}
                        <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--faint)]">
                          Every line here comes from a link recorded in the catalogue. If a link is not in the data, it is not on this diagram.
                        </p>
                      </div>
                    </div>
                    <div className="net-legend">
                      {LEGEND.map(([colour, label]) => (
                        <span key={label}><i style={{ background: colour }} /> {label}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty"><Share2 size={26} /><strong>Nothing to draw yet</strong><span>Analyse a tender, or pick a record from the standards list.</span></div>
                )}
              </div>
            </>
          )}

          {/* ---------------- Standards list ---------------- */}
          {view === "standards" && (
            <>
              <p className="eyebrow">Standards list</p>
              <h1 className="display mt-3">Everything in the catalogue</h1>
              <p className="lede">{totalCount} records. {verifiedCount} has been checked by a person; the others show where they came from and say they still need checking.</p>
              <div className="card card-pad mt-6">
                {standards.map(s => (
                  <div className="result" key={s.id} style={{ cursor: "default" }}>
                    <span className={`ring ${tierOf(s) === "verified" ? "hi" : tierOf(s) === "checking" ? "mid" : "lo"}`}>
                      {tierOf(s) === "verified" ? <ShieldCheck size={18} /> : tierOf(s) === "checking" ? <Clock3 size={18} /> : <FileText size={18} />}
                    </span>
                    <span className="min-w-0">
                      <Identifier standard={s} />
                      <h4>{s.official_title}</h4>
                      <p className="sub">{s.scope_summary.slice(0, 130)}{s.scope_summary.length > 130 ? "…" : ""}</p>
                    </span>
                    <span className="flex items-center gap-1">
                      <button className="icon-btn" onClick={() => showNetworkFor(s)} aria-label="See how this connects" title="See how this connects"><Share2 size={16} /></button>
                      {s.official_source_url
                        ? <a className="icon-btn" href={s.official_source_url} target="_blank" rel="noopener noreferrer" aria-label="Open official page" title="Open official page"><Link2 size={16} /></a>
                        : <span className="icon-btn opacity-25" title="No official page"><Link2 size={16} /></span>}
                    </span>
                  </div>
                ))}
                {!standards.length && <div className="empty"><strong>Nothing found</strong><span>Try a different word, or clear the search box above.</span></div>}
              </div>
            </>
          )}

          {/* ---------------- Reports ---------------- */}
          {view === "analytics" && (
            <section className="anim-in">
              <p className="eyebrow">{t("analytics")}</p>
              <h1 className="display mt-3">{t("watchTitle")} &amp; {t("analytics").toLowerCase()}</h1>
              <div className="mt-6">
                <AnalyticsView t={t} />
              </div>
            </section>
          )}

          {view === "reports" && (
            <>
              <p className="eyebrow">Download report</p>
              <h1 className="display mt-3">Take it away</h1>
              <p className="lede">A record of this analysis, ready to attach to your file or share with a colleague.</p>
              {analysis ? (
                <div className="card card-pad mt-6">
                  <h3 className="section-head">{analysis.tender.title}</h3>
                  <p className="section-sub">Reference {analysis.tender.reference}</p>
                  <div className="mt-5 grid gap-9 sm:grid-cols-2 lg:grid-cols-4">
                    {([["pdf", "PDF"], ["docx", "Word"], ["xlsx", "Excel"], ["json", "Data file"]] as const).map(([fmt, label]) => (
                      <button key={fmt} className="btn btn-ghost" onClick={() => exportReport(fmt)}><FileText size={15} /> {label}</button>
                    ))}
                  </div>
                  <div className="notice amber mt-5">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                    <span>Records marked <strong>Needs checking</strong> or <strong>Example only</strong> are labelled as such in the file, so nobody mistakes them for confirmed standards.</span>
                  </div>
                </div>
              ) : (
                <div className="card mt-6"><div className="empty"><FileCheck2 size={26} /><strong>Nothing to download yet</strong><span>Analyse a tender first, then come back here.</span></div></div>
              )}
            </>
          )}

          {/* ---------------- History ---------------- */}
          {view === "audit" && (
            <>
              <p className="eyebrow">History</p>
              <h1 className="display mt-3">Who did what, and when</h1>
              <p className="lede">Every sign-in, analysis, decision and download is recorded here.</p>
              <div className="card card-pad mt-6">
                {audit.map(a => (
                  <div className="rowcard" key={a.id}>
                    <span className="ico"><History size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <dd className="font-semibold">{a.action.replaceAll(".", " ").replaceAll("_", " ")}</dd>
                      <dt className="mt-1 normal-case tracking-normal">{new Date(a.created_at).toLocaleString()}</dt>
                    </div>
                  </div>
                ))}
                {!audit.length && <div className="empty"><strong>Nothing recorded yet</strong><span>Activity will appear here as you use the system.</span></div>}
              </div>
            </>
          )}
        </div>
      </div>

      {openResult && <DetailPanel item={openResult} onClose={() => setOpenResult(null)} />}
      {toast && <div className="toast"><CheckCircle2 size={15} /> {toast}</div>}
    </div>
  );
}
