"use client";

import {
  Armchair, ArrowRight, BarChart3, BookOpenCheck, Boxes, Building2, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Droplets, FileCheck2,
  FileSearch, FileText, HardHat, History, LayoutDashboard, Link2, LoaderCircle, LockKeyhole,
  Globe2, LogOut, PlugZap, Search, Share2, ShieldCheck, Sparkles, TriangleAlert, UploadCloud, X,
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
// One-tap examples under the hero search: four scripts, four products, so the
// multilingual pipeline demonstrates itself.
const TRY_EXAMPLES = [
  { chip: "Safety helmets", text: "Purchase of 500 industrial safety helmets for construction workers with impact testing and ISI marking." },
  { chip: "सीमेंट खरीद", text: "निर्माण कार्य के लिए 500 बैग पोर्टलैंड सीमेंट की खरीद, गुणवत्ता परीक्षण प्रमाणपत्र आवश्यक।" },
  { chip: "తాగునీరు", text: "కార్యాలయానికి ప్యాకేజ్డ్ తాగునీరు సరఫరా, నాణ్యత ధృవీకరణ అవసరం." },
  { chip: "பாதுகாப்பு காலணி", text: "தொழிற்சாலை தொழிலாளர்களுக்கு 300 ஜோடி பாதுகாப்பு காலணி கொள்முதல், சோதனை சான்றிதழ் தேவை." },
];

// The category cards: a coloured door into the same pipeline.
const CAT_CARDS: Array<{ cls: string; icon: React.ElementType; titleKey: string; subKey: string; example?: string }> = [
  { cls: "cat-coral", icon: HardHat, titleKey: "cat1", subKey: "cat1s", example: "Purchase of 500 industrial safety helmets for construction workers with impact testing and ISI marking." },
  { cls: "cat-yellow", icon: Building2, titleKey: "cat2", subKey: "cat2s", example: "Supply of ordinary portland cement for construction works, 500 bags, with laboratory test certificates." },
  { cls: "cat-violet", icon: PlugZap, titleKey: "cat3", subKey: "cat3s", example: "Procurement of PVC insulated copper cables 1.5 sq mm for office wiring, ISI marked, with acceptance testing." },
  { cls: "cat-teal", icon: Droplets, titleKey: "cat4", subKey: "cat4s", example: "Supply of packaged drinking water for government offices, quality certification required." },
  { cls: "cat-blue", icon: Armchair, titleKey: "cat5", subKey: "cat5s", example: "Purchase of classroom desks and benches for a government school, 200 sets, with durability testing." },
  { cls: "cat-pink", icon: Boxes, titleKey: "cat6", subKey: "cat6s" },
];

// What lives in the topnav directly; everything else sits behind "More".
const PRIMARY_VIEWS: View[] = ["overview", "analyse", "standards"];
const MORE_DESC: Record<string, string> = {
  network: "moreNet",
  analytics: "moreAna",
  reports: "moreRep",
  audit: "moreHis",
};

const DEMO_OFFICER = { email: "officer@manaksetu.gov.in", password: "ManakSetu@2026" };
const DEMO_SUPPLIER = { email: "supplier@example.in", password: "ManakSetu@2026" };


/* ---------------------------------------------------------------------
   Interface language. The tender itself is always read in whatever
   language it was written in -- this only changes the words around it, so
   an officer can work in their own language.
   --------------------------------------------------------------------- */

type UiLang = "en" | "hi" | "te" | "ta" | "bn" | "mr" | "gu" | "pa" | "kn" | "ml";

const UI_LANGS: Array<{ code: UiLang; label: string; native: string }> = [
  { code: "en", label: "EN", native: "English" },
  { code: "hi", label: "हि", native: "हिन्दी" },
  { code: "te", label: "తె", native: "తెలుగు" },
  { code: "ta", label: "த", native: "தமிழ்" },
  { code: "bn", label: "বা", native: "বাংলা" },
  { code: "mr", label: "म", native: "मराठी" },
  { code: "gu", label: "ગુ", native: "ગુજરાતી" },
  { code: "pa", label: "ਪੰ", native: "ਪੰਜਾਬੀ" },
  { code: "kn", label: "ಕ", native: "ಕನ್ನಡ" },
  { code: "ml", label: "മ", native: "മലയാളം" },
];

// The first four languages are complete; the remaining six cover the landing
// and navigation layer, and t() falls back to English for anything else.
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
    handWelcome: "Namaste! Let's get you the right standards.",
    heroQ1: "What are you", heroQ2: "buying today?",
    heroSubNew: "Tell us in your own words — English, हिन्दी, తెలుగు or தமிழ். We find the Indian Standards that apply, with the proof behind every single one.",
    heroPlaceholder: "Describe your purchase in your own words…",
    tryWord: "Try:",
    cat1: "Safety & PPE", cat1s: "Helmets, boots, gloves.",
    cat2: "Construction", cat2s: "Cement, steel, concrete.",
    cat3: "Electrical", cat3s: "Cables, wiring, power.",
    cat4: "Water & Food", cat4s: "Drinking water, packaging.",
    cat5: "Office & School", cat5s: "Desks, benches, boards.",
    cat6: "Everything else", cat6s: "Browse 2,900+ standards.",
    journeyTitle: "Your analysis journey", journeyEmpty: "Nothing running yet — type what you are buying above and watch this light up.",
    openIt: "Open it",
    j1: "Tender read", j2: "Details pulled out", j3: "Standards searched", j4: "Your decision",
    jDone: "Done", jActive: "In progress", jWait: "Waiting",
    howTitle: "How it works", howHand: "easy as 1·2·3·4",
    flow1t: "Describe the purchase", flow1p: "Type a few lines or upload the tender — scanned pages are read automatically.",
    flow2t: "We understand it", flow2p: "Product, quantity, testing, safety — pulled out and shown to you for confirmation.",
    flow3t: "We search by meaning", flow3p: "‘Head protection’ finds helmet standards even without the word ‘helmet’ — in four languages.",
    flow4t: "You approve", flow4p: "Every result shows its proof. Nothing is final until you say so.",
    footLang: "4 languages", footLocal: "100% local AI — nothing leaves this machine",
    footZero: "Zero invented standard numbers", footAudit: "Every action audited",
    more: "More", moreNet: "Animated knowledge graph", moreAna: "Deep analytics & currency watch",
    moreRep: "Download report", moreHis: "History & audit trail",
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
    handWelcome: "नमस्ते! आपके लिए सही मानक ढूँढते हैं।",
    heroQ1: "आज आप", heroQ2: "क्या खरीद रहे हैं?",
    heroSubNew: "अपने शब्दों में बताइए — English, हिन्दी, తెలుగు या தமிழ். हम लागू भारतीय मानक ढूँढते हैं, हर एक के पीछे प्रमाण के साथ।",
    heroPlaceholder: "अपनी खरीद अपने शब्दों में लिखिए…",
    tryWord: "आज़माएँ:",
    cat1: "सुरक्षा और PPE", cat1s: "हेलमेट, जूते, दस्ताने।",
    cat2: "निर्माण", cat2s: "सीमेंट, स्टील, कंक्रीट।",
    cat3: "विद्युत", cat3s: "केबल, वायरिंग, बिजली।",
    cat4: "जल और खाद्य", cat4s: "पेयजल, पैकेजिंग।",
    cat5: "कार्यालय व विद्यालय", cat5s: "डेस्क, बेंच, बोर्ड।",
    cat6: "बाकी सब कुछ", cat6s: "2,900+ मानक देखें।",
    journeyTitle: "आपकी विश्लेषण यात्रा", journeyEmpty: "अभी कुछ नहीं चल रहा — ऊपर लिखिए कि आप क्या खरीद रहे हैं, और इसे जगमगाते देखिए।",
    openIt: "खोलें",
    j1: "निविदा पढ़ी गई", j2: "विवरण निकाले गए", j3: "मानक खोजे गए", j4: "आपका निर्णय",
    jDone: "पूर्ण", jActive: "जारी", jWait: "प्रतीक्षा में",
    howTitle: "यह कैसे काम करता है", howHand: "1·2·3·4 जितना आसान",
    flow1t: "खरीद का विवरण दें", flow1p: "कुछ पंक्तियाँ लिखें या निविदा अपलोड करें — स्कैन पन्ने अपने आप पढ़े जाते हैं।",
    flow2t: "हम उसे समझते हैं", flow2p: "उत्पाद, मात्रा, परीक्षण, सुरक्षा — निकालकर पुष्टि के लिए आपको दिखाए जाते हैं।",
    flow3t: "हम अर्थ से खोजते हैं", flow3p: "‘सिर की सुरक्षा’ से हेलमेट मानक मिल जाते हैं, ‘हेलमेट’ शब्द के बिना भी — चार भाषाओं में।",
    flow4t: "आप स्वीकृति देते हैं", flow4p: "हर परिणाम अपना प्रमाण दिखाता है। आपकी हाँ के बिना कुछ भी अंतिम नहीं।",
    footLang: "4 भाषाएँ", footLocal: "100% स्थानीय AI — कुछ भी इस मशीन से बाहर नहीं जाता",
    footZero: "शून्य गढ़े गए मानक क्रमांक", footAudit: "हर कार्रवाई का अभिलेख",
    more: "और", moreNet: "सजीव ज्ञान ग्राफ़", moreAna: "गहन विश्लेषिकी और वैधता निगरानी",
    moreRep: "रिपोर्ट डाउनलोड", moreHis: "इतिहास और ऑडिट",
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
    handWelcome: "నమస్తే! మీకు సరైన ప్రమాణాలు వెతుకుదాం.",
    heroQ1: "ఈరోజు మీరు", heroQ2: "ఏమి కొంటున్నారు?",
    heroSubNew: "మీ మాటల్లోనే చెప్పండి — English, हिन्दी, తెలుగు లేదా தமிழ். వర్తించే భారతీయ ప్రమాణాలను, ప్రతి దాని వెనుక ఆధారంతో సహా వెతికిస్తాం.",
    heroPlaceholder: "మీ కొనుగోలును మీ మాటల్లో రాయండి…",
    tryWord: "ప్రయత్నించండి:",
    cat1: "భద్రత & PPE", cat1s: "హెల్మెట్లు, బూట్లు, గ్లోవ్స్.",
    cat2: "నిర్మాణం", cat2s: "సిమెంట్, స్టీల్, కాంక్రీట్.",
    cat3: "విద్యుత్", cat3s: "కేబుల్స్, వైరింగ్, విద్యుత్.",
    cat4: "నీరు & ఆహారం", cat4s: "తాగునీరు, ప్యాకేజింగ్.",
    cat5: "కార్యాలయం & పాఠశాల", cat5s: "డెస్కులు, బెంచీలు, బోర్డులు.",
    cat6: "మిగతావన్నీ", cat6s: "2,900+ ప్రమాణాలు చూడండి.",
    journeyTitle: "మీ విశ్లేషణ ప్రయాణం", journeyEmpty: "ఇంకా ఏమీ నడవడం లేదు — పైన మీరు ఏమి కొంటున్నారో రాయండి, ఇది వెలగడం చూడండి.",
    openIt: "తెరవండి",
    j1: "టెండర్ చదవబడింది", j2: "వివరాలు తీయబడ్డాయి", j3: "ప్రమాణాలు వెతకబడ్డాయి", j4: "మీ నిర్ణయం",
    jDone: "పూర్తి", jActive: "జరుగుతోంది", jWait: "వేచి ఉంది",
    howTitle: "ఇది ఎలా పనిచేస్తుంది", howHand: "1·2·3·4 అంత సులభం",
    flow1t: "కొనుగోలును వివరించండి", flow1p: "కొన్ని వాక్యాలు రాయండి లేదా టెండర్ అప్‌లోడ్ చేయండి — స్కాన్ పేజీలు వాటంతటవే చదవబడతాయి.",
    flow2t: "మేము అర్థం చేసుకుంటాం", flow2p: "ఉత్పత్తి, పరిమాణం, పరీక్షలు, భద్రత — తీసి మీ నిర్ధారణ కోసం చూపిస్తాం.",
    flow3t: "అర్థంతో వెతుకుతాం", flow3p: "‘తల రక్షణ’ అంటే ‘హెల్మెట్’ పదం లేకుండానే హెల్మెట్ ప్రమాణాలు దొరుకుతాయి — నాలుగు భాషల్లో.",
    flow4t: "మీరు ఆమోదిస్తారు", flow4p: "ప్రతి ఫలితం తన ఆధారాన్ని చూపుతుంది. మీరు సరే అనే వరకు ఏదీ తుది కాదు.",
    footLang: "4 భాషలు", footLocal: "100% స్థానిక AI — ఏదీ ఈ యంత్రం బయటకు వెళ్ళదు",
    footZero: "సున్నా కల్పిత ప్రమాణ సంఖ్యలు", footAudit: "ప్రతి చర్యకు ఆడిట్",
    more: "మరిన్ని", moreNet: "సజీవ నాలెడ్జ్ గ్రాఫ్", moreAna: "లోతైన విశ్లేషణలు & చెల్లుబాటు పర్యవేక్షణ",
    moreRep: "నివేదిక డౌన్‌లోడ్", moreHis: "చరిత్ర & ఆడిట్",
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
    handWelcome: "வணக்கம்! உங்களுக்கு சரியான தரநிலைகளைக் கண்டுபிடிப்போம்.",
    heroQ1: "இன்று நீங்கள்", heroQ2: "என்ன வாங்குகிறீர்கள்?",
    heroSubNew: "உங்கள் சொற்களிலேயே சொல்லுங்கள் — English, हिन्दी, తెలుగు அல்லது தமிழ். பொருந்தும் இந்தியத் தரநிலைகளை, ஒவ்வொன்றுக்கும் ஆதாரத்துடன் கண்டுபிடிக்கிறோம்.",
    heroPlaceholder: "உங்கள் கொள்முதலை உங்கள் சொற்களில் எழுதுங்கள்…",
    tryWord: "முயற்சி:",
    cat1: "பாதுகாப்பு & PPE", cat1s: "தலைக்கவசம், பூட்ஸ், கையுறை.",
    cat2: "கட்டுமானம்", cat2s: "சிமெண்ட், எஃகு, காங்கிரீட்.",
    cat3: "மின்சாரம்", cat3s: "கேபிள், வயரிங், மின்சாரம்.",
    cat4: "நீர் & உணவு", cat4s: "குடிநீர், பேக்கேஜிங்.",
    cat5: "அலுவலகம் & பள்ளி", cat5s: "மேசை, பெஞ்ச், பலகை.",
    cat6: "மற்ற அனைத்தும்", cat6s: "2,900+ தரநிலைகளைப் பார்.",
    journeyTitle: "உங்கள் பகுப்பாய்வு பயணம்", journeyEmpty: "இன்னும் எதுவும் இல்லை — மேலே நீங்கள் என்ன வாங்குகிறீர்கள் என்று எழுதி, இது ஒளிர்வதைப் பாருங்கள்.",
    openIt: "திற",
    j1: "டெண்டர் படிக்கப்பட்டது", j2: "விவரங்கள் எடுக்கப்பட்டன", j3: "தரநிலைகள் தேடப்பட்டன", j4: "உங்கள் முடிவு",
    jDone: "முடிந்தது", jActive: "நடக்கிறது", jWait: "காத்திருப்பு",
    howTitle: "இது எப்படி வேலை செய்கிறது", howHand: "1·2·3·4 போல எளிது",
    flow1t: "கொள்முதலை விவரியுங்கள்", flow1p: "சில வரிகள் எழுதுங்கள் அல்லது டெண்டரைப் பதிவேற்றுங்கள் — ஸ்கேன் பக்கங்கள் தானாகப் படிக்கப்படும்.",
    flow2t: "நாங்கள் புரிந்துகொள்கிறோம்", flow2p: "பொருள், அளவு, சோதனை, பாதுகாப்பு — எடுத்து உங்கள் உறுதிப்படுத்தலுக்குக் காட்டப்படும்.",
    flow3t: "பொருளால் தேடுகிறோம்", flow3p: "‘தலை பாதுகாப்பு’ என்றாலே ‘தலைக்கவசம்’ என்ற சொல் இல்லாமலும் தரநிலைகள் கிடைக்கும் — நான்கு மொழிகளில்.",
    flow4t: "நீங்கள் ஒப்புதல் அளிக்கிறீர்கள்", flow4p: "ஒவ்வொரு முடிவும் தன் ஆதாரத்தைக் காட்டுகிறது. நீங்கள் சரி என்னும் வரை எதுவும் இறுதி இல்லை.",
    footLang: "4 மொழிகள்", footLocal: "100% உள்ளூர் AI — எதுவும் இந்த கணினியை விட்டு வெளியேறாது",
    footZero: "பூஜ்ஜியம் கற்பனை தரநிலை எண்கள்", footAudit: "ஒவ்வொரு செயலுக்கும் தணிக்கை",
    more: "மேலும்", moreNet: "அசைவூட்டப்பட்ட அறிவு வரைபடம்", moreAna: "ஆழ்ந்த பகுப்பாய்வு & செல்லுபடி கண்காணிப்பு",
    moreRep: "அறிக்கை பதிவிறக்கம்", moreHis: "வரலாறு & தணிக்கை",
  },
  bn: {
    overview: "সারসংক্ষেপ", analyse: "টেন্ডার বিশ্লেষণ", network: "সংযোগ", standards: "মানের তালিকা",
    analytics: "বিশ্লেষণ", reports: "রিপোর্ট ডাউনলোড", history: "ইতিহাস",
    handWelcome: "নমস্কার! আপনার জন্য সঠিক মান খুঁজে দিই।",
    heroQ1: "আজ আপনি", heroQ2: "কী কিনছেন?",
    heroSubNew: "নিজের ভাষায় লিখুন — যে কোনও ভারতীয় ভাষায়। প্রযোজ্য ভারতীয় মান খুঁজে দিই, প্রতিটির পেছনে প্রমাণসহ।",
    heroPlaceholder: "আপনার কেনাকাটা নিজের ভাষায় লিখুন…", tryWord: "চেষ্টা করুন:",
    cat1: "নিরাপত্তা ও PPE", cat1s: "হেলমেট, জুতা, দস্তানা।", cat2: "নির্মাণ", cat2s: "সিমেন্ট, স্টিল, কংক্রিট।",
    cat3: "বৈদ্যুতিক", cat3s: "কেবল, ওয়্যারিং।", cat4: "জল ও খাদ্য", cat4s: "পানীয় জল, প্যাকেজিং।",
    cat5: "অফিস ও স্কুল", cat5s: "ডেস্ক, বেঞ্চ, বোর্ড।", cat6: "অন্য সবকিছু", cat6s: "২,৯০০+ মান দেখুন।",
    journeyTitle: "আপনার বিশ্লেষণ যাত্রা", journeyEmpty: "এখনও কিছু চলছে না — উপরে লিখুন আপনি কী কিনছেন।",
    openIt: "খুলুন", j1: "টেন্ডার পড়া হয়েছে", j2: "বিবরণ বের করা হয়েছে", j3: "মান খোঁজা হয়েছে", j4: "আপনার সিদ্ধান্ত",
    jDone: "সম্পন্ন", jActive: "চলছে", jWait: "অপেক্ষায়",
    howTitle: "এটি কীভাবে কাজ করে", howHand: "১·২·৩·৪ এর মতো সহজ",
    flow1t: "কেনাকাটা বর্ণনা করুন", flow1p: "কয়েক লাইন লিখুন বা টেন্ডার আপলোড করুন — স্ক্যান পাতাও পড়া হয়।",
    flow2t: "আমরা বুঝে নিই", flow2p: "পণ্য, পরিমাণ, পরীক্ষা, নিরাপত্তা — বের করে আপনার নিশ্চিতকরণের জন্য দেখাই।",
    flow3t: "অর্থ দিয়ে খুঁজি", flow3p: "‘মাথার সুরক্ষা’ লিখলেই হেলমেটের মান পাওয়া যায় — বহু ভাষায়।",
    flow4t: "আপনি অনুমোদন করেন", flow4p: "প্রতিটি ফলাফল তার প্রমাণ দেখায়। আপনার সম্মতি ছাড়া কিছুই চূড়ান্ত নয়।",
    statCatalogue: "তালিকায় মান", statInvented: "বানানো মান নম্বর", statTenders: "বিশ্লেষিত টেন্ডার",
    footLang: "১০টি ভাষা", footLocal: "১০০% স্থানীয় AI — কিছুই এই মেশিনের বাইরে যায় না",
    footZero: "শূন্য বানানো মান নম্বর", footAudit: "প্রতিটি কাজের নিরীক্ষা",
    more: "আরও", moreNet: "সজীব জ্ঞান গ্রাফ", moreAna: "গভীর বিশ্লেষণ ও বৈধতা নজরদারি",
    moreRep: "রিপোর্ট ডাউনলোড", moreHis: "ইতিহাস ও নিরীক্ষা",
    newTender: "নতুন টেন্ডার বিশ্লেষণ", browse: "মান দেখুন", findStandards: "মান খুঁজুন",
    working: "কাজ চলছে…", startNew: "নতুন বিশ্লেষণ শুরু করুন", searchPlaceholder: "নাম দিয়ে মান খুঁজুন…",
    verified: "যাচাইকৃত", checking: "যাচাই প্রয়োজন", example: "শুধু উদাহরণ",
  },
  mr: {
    overview: "आढावा", analyse: "निविदा विश्लेषण", network: "जोडण्या", standards: "मानक यादी",
    analytics: "विश्लेषण", reports: "अहवाल डाउनलोड", history: "इतिहास",
    handWelcome: "नमस्कार! तुमच्यासाठी योग्य मानके शोधूया.",
    heroQ1: "आज तुम्ही", heroQ2: "काय खरेदी करत आहात?",
    heroSubNew: "तुमच्या शब्दांत सांगा — कोणत्याही भारतीय भाषेत. लागू होणारी भारतीय मानके शोधतो, प्रत्येकामागे पुराव्यासह.",
    heroPlaceholder: "तुमची खरेदी तुमच्या शब्दांत लिहा…", tryWord: "करून पाहा:",
    cat1: "सुरक्षा व PPE", cat1s: "हेल्मेट, बूट, हातमोजे.", cat2: "बांधकाम", cat2s: "सिमेंट, स्टील, काँक्रीट.",
    cat3: "विद्युत", cat3s: "केबल, वायरिंग.", cat4: "पाणी व अन्न", cat4s: "पिण्याचे पाणी, पॅकेजिंग.",
    cat5: "कार्यालय व शाळा", cat5s: "डेस्क, बाक, फळे.", cat6: "इतर सर्व", cat6s: "२,९००+ मानके पाहा.",
    journeyTitle: "तुमचा विश्लेषण प्रवास", journeyEmpty: "अजून काही सुरू नाही — वर लिहा तुम्ही काय खरेदी करत आहात.",
    openIt: "उघडा", j1: "निविदा वाचली", j2: "तपशील काढले", j3: "मानके शोधली", j4: "तुमचा निर्णय",
    jDone: "पूर्ण", jActive: "सुरू आहे", jWait: "प्रतीक्षेत",
    howTitle: "हे कसे चालते", howHand: "१·२·३·४ इतके सोपे",
    flow1t: "खरेदीचे वर्णन करा", flow1p: "काही ओळी लिहा किंवा निविदा अपलोड करा — स्कॅन पानेही वाचली जातात.",
    flow2t: "आम्ही समजून घेतो", flow2p: "उत्पादन, प्रमाण, चाचणी, सुरक्षा — काढून तुमच्या पुष्टीसाठी दाखवतो.",
    flow3t: "अर्थाने शोधतो", flow3p: "‘डोक्याचे संरक्षण’ लिहिले तरी हेल्मेटची मानके सापडतात — अनेक भाषांत.",
    flow4t: "तुम्ही मंजुरी देता", flow4p: "प्रत्येक निकाल त्याचा पुरावा दाखवतो. तुमच्या होकाराशिवाय काहीही अंतिम नाही.",
    statCatalogue: "यादीतील मानके", statInvented: "रचलेले मानक क्रमांक", statTenders: "विश्लेषित निविदा",
    footLang: "१० भाषा", footLocal: "१००% स्थानिक AI — काहीही या मशीनबाहेर जात नाही",
    footZero: "शून्य रचलेले मानक क्रमांक", footAudit: "प्रत्येक कृतीची नोंद",
    more: "आणखी", moreNet: "सजीव ज्ञान आलेख", moreAna: "सखोल विश्लेषण व वैधता देखरेख",
    moreRep: "अहवाल डाउनलोड", moreHis: "इतिहास व लेखापरीक्षण",
    newTender: "नवीन निविदा विश्लेषण", browse: "मानके पाहा", findStandards: "मानके शोधा",
    working: "काम सुरू…", startNew: "नवीन विश्लेषण सुरू करा", searchPlaceholder: "नावाने मानके शोधा…",
    verified: "पडताळलेले", checking: "तपासणी आवश्यक", example: "केवळ उदाहरण",
  },
  gu: {
    overview: "ઝાંખી", analyse: "ટેન્ડર વિશ્લેષણ", network: "જોડાણો", standards: "માનક યાદી",
    analytics: "વિશ્લેષણ", reports: "રિપોર્ટ ડાઉનલોડ", history: "ઇતિહાસ",
    handWelcome: "નમસ્તે! તમારા માટે યોગ્ય માનકો શોધીએ.",
    heroQ1: "આજે તમે", heroQ2: "શું ખરીદો છો?",
    heroSubNew: "તમારા શબ્દોમાં કહો — કોઈપણ ભારતીય ભાષામાં. લાગુ પડતાં ભારતીય માનકો શોધીએ છીએ, દરેકની પાછળ પુરાવા સાથે.",
    heroPlaceholder: "તમારી ખરીદી તમારા શબ્દોમાં લખો…", tryWord: "અજમાવો:",
    cat1: "સલામતી અને PPE", cat1s: "હેલ્મેટ, બૂટ, મોજાં.", cat2: "બાંધકામ", cat2s: "સિમેન્ટ, સ્ટીલ, કોંક્રીટ.",
    cat3: "વિદ્યુત", cat3s: "કેબલ, વાયરિંગ.", cat4: "પાણી અને ખોરાક", cat4s: "પીવાનું પાણી, પેકેજિંગ.",
    cat5: "ઓફિસ અને શાળા", cat5s: "ડેસ્ક, બેન્ચ, બોર્ડ.", cat6: "બાકી બધું", cat6s: "૨,૯૦૦+ માનકો જુઓ.",
    journeyTitle: "તમારી વિશ્લેષણ યાત્રા", journeyEmpty: "હજી કંઈ ચાલી રહ્યું નથી — ઉપર લખો કે તમે શું ખરીદો છો.",
    openIt: "ખોલો", j1: "ટેન્ડર વંચાયું", j2: "વિગતો કઢાઈ", j3: "માનકો શોધાયાં", j4: "તમારો નિર્ણય",
    jDone: "પૂર્ણ", jActive: "ચાલુ છે", jWait: "રાહમાં",
    howTitle: "આ કેવી રીતે કામ કરે છે", howHand: "૧·૨·૩·૪ જેટલું સરળ",
    flow1t: "ખરીદીનું વર્ણન કરો", flow1p: "થોડી લીટીઓ લખો કે ટેન્ડર અપલોડ કરો — સ્કેન પાનાં પણ વંચાય છે.",
    flow2t: "અમે સમજી લઈએ", flow2p: "ઉત્પાદન, જથ્થો, પરીક્ષણ, સલામતી — કાઢીને તમારી પુષ્ટિ માટે બતાવીએ.",
    flow3t: "અર્થથી શોધીએ", flow3p: "‘માથાનું રક્ષણ’ લખો તોય હેલ્મેટનાં માનકો મળે — અનેક ભાષાઓમાં.",
    flow4t: "તમે મંજૂરી આપો", flow4p: "દરેક પરિણામ પોતાનો પુરાવો બતાવે છે. તમારી હા વિના કંઈ અંતિમ નથી.",
    statCatalogue: "યાદીમાં માનકો", statInvented: "ઘડેલા માનક નંબરો", statTenders: "વિશ્લેષિત ટેન્ડરો",
    footLang: "૧૦ ભાષાઓ", footLocal: "૧૦૦% સ્થાનિક AI — કંઈ પણ આ મશીન બહાર જતું નથી",
    footZero: "શૂન્ય ઘડેલા માનક નંબરો", footAudit: "દરેક ક્રિયાની નોંધ",
    more: "વધુ", moreNet: "સજીવ જ્ઞાન ગ્રાફ", moreAna: "ઊંડું વિશ્લેષણ અને માન્યતા દેખરેખ",
    moreRep: "રિપોર્ટ ડાઉનલોડ", moreHis: "ઇતિહાસ અને ઓડિટ",
    newTender: "નવું ટેન્ડર વિશ્લેષણ", browse: "માનકો જુઓ", findStandards: "માનકો શોધો",
    working: "કામ ચાલુ…", startNew: "નવું વિશ્લેષણ શરૂ કરો", searchPlaceholder: "નામથી માનકો શોધો…",
    verified: "ચકાસાયેલ", checking: "તપાસ જરૂરી", example: "માત્ર ઉદાહરણ",
  },
  pa: {
    overview: "ਝਲਕ", analyse: "ਟੈਂਡਰ ਵਿਸ਼ਲੇਸ਼ਣ", network: "ਜੋੜ", standards: "ਮਿਆਰ ਸੂਚੀ",
    analytics: "ਵਿਸ਼ਲੇਸ਼ਣ", reports: "ਰਿਪੋਰਟ ਡਾਊਨਲੋਡ", history: "ਇਤਿਹਾਸ",
    handWelcome: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਹਾਡੇ ਲਈ ਸਹੀ ਮਿਆਰ ਲੱਭੀਏ।",
    heroQ1: "ਅੱਜ ਤੁਸੀਂ", heroQ2: "ਕੀ ਖਰੀਦ ਰਹੇ ਹੋ?",
    heroSubNew: "ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਦੱਸੋ — ਕਿਸੇ ਵੀ ਭਾਰਤੀ ਭਾਸ਼ਾ ਵਿੱਚ। ਲਾਗੂ ਭਾਰਤੀ ਮਿਆਰ ਲੱਭਦੇ ਹਾਂ, ਹਰ ਇੱਕ ਪਿੱਛੇ ਸਬੂਤ ਨਾਲ।",
    heroPlaceholder: "ਆਪਣੀ ਖਰੀਦ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਲਿਖੋ…", tryWord: "ਅਜ਼ਮਾਓ:",
    cat1: "ਸੁਰੱਖਿਆ ਅਤੇ PPE", cat1s: "ਹੈਲਮੇਟ, ਬੂਟ, ਦਸਤਾਨੇ।", cat2: "ਉਸਾਰੀ", cat2s: "ਸੀਮਿੰਟ, ਸਟੀਲ, ਕੰਕਰੀਟ।",
    cat3: "ਬਿਜਲਈ", cat3s: "ਕੇਬਲ, ਵਾਇਰਿੰਗ।", cat4: "ਪਾਣੀ ਅਤੇ ਖੁਰਾਕ", cat4s: "ਪੀਣ ਵਾਲਾ ਪਾਣੀ, ਪੈਕੇਜਿੰਗ।",
    cat5: "ਦਫ਼ਤਰ ਅਤੇ ਸਕੂਲ", cat5s: "ਡੈਸਕ, ਬੈਂਚ, ਬੋਰਡ।", cat6: "ਬਾਕੀ ਸਭ", cat6s: "੨,੯੦੦+ ਮਿਆਰ ਵੇਖੋ।",
    journeyTitle: "ਤੁਹਾਡਾ ਵਿਸ਼ਲੇਸ਼ਣ ਸਫ਼ਰ", journeyEmpty: "ਹਾਲੇ ਕੁਝ ਨਹੀਂ ਚੱਲ ਰਿਹਾ — ਉੱਪਰ ਲਿਖੋ ਤੁਸੀਂ ਕੀ ਖਰੀਦ ਰਹੇ ਹੋ।",
    openIt: "ਖੋਲ੍ਹੋ", j1: "ਟੈਂਡਰ ਪੜ੍ਹਿਆ ਗਿਆ", j2: "ਵੇਰਵੇ ਕੱਢੇ ਗਏ", j3: "ਮਿਆਰ ਲੱਭੇ ਗਏ", j4: "ਤੁਹਾਡਾ ਫੈਸਲਾ",
    jDone: "ਮੁਕੰਮਲ", jActive: "ਜਾਰੀ", jWait: "ਉਡੀਕ ਵਿੱਚ",
    howTitle: "ਇਹ ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ", howHand: "੧·੨·੩·੪ ਜਿੰਨਾ ਸੌਖਾ",
    flow1t: "ਖਰੀਦ ਦਾ ਵੇਰਵਾ ਦਿਓ", flow1p: "ਕੁਝ ਲਾਈਨਾਂ ਲਿਖੋ ਜਾਂ ਟੈਂਡਰ ਅੱਪਲੋਡ ਕਰੋ — ਸਕੈਨ ਪੰਨੇ ਵੀ ਪੜ੍ਹੇ ਜਾਂਦੇ ਹਨ।",
    flow2t: "ਅਸੀਂ ਸਮਝ ਲੈਂਦੇ ਹਾਂ", flow2p: "ਉਤਪਾਦ, ਮਾਤਰਾ, ਟੈਸਟ, ਸੁਰੱਖਿਆ — ਕੱਢ ਕੇ ਤੁਹਾਡੀ ਪੁਸ਼ਟੀ ਲਈ ਵਿਖਾਉਂਦੇ ਹਾਂ।",
    flow3t: "ਅਰਥ ਨਾਲ ਖੋਜਦੇ ਹਾਂ", flow3p: "‘ਸਿਰ ਦੀ ਸੁਰੱਖਿਆ’ ਲਿਖੋ ਤਾਂ ਵੀ ਹੈਲਮੇਟ ਦੇ ਮਿਆਰ ਮਿਲਦੇ ਹਨ — ਕਈ ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ।",
    flow4t: "ਤੁਸੀਂ ਮਨਜ਼ੂਰੀ ਦਿੰਦੇ ਹੋ", flow4p: "ਹਰ ਨਤੀਜਾ ਆਪਣਾ ਸਬੂਤ ਵਿਖਾਉਂਦਾ ਹੈ। ਤੁਹਾਡੀ ਹਾਂ ਬਿਨਾਂ ਕੁਝ ਵੀ ਅੰਤਿਮ ਨਹੀਂ।",
    statCatalogue: "ਸੂਚੀ ਵਿੱਚ ਮਿਆਰ", statInvented: "ਘੜੇ ਹੋਏ ਮਿਆਰ ਨੰਬਰ", statTenders: "ਵਿਸ਼ਲੇਸ਼ਿਤ ਟੈਂਡਰ",
    footLang: "੧੦ ਭਾਸ਼ਾਵਾਂ", footLocal: "੧੦੦% ਸਥਾਨਕ AI — ਕੁਝ ਵੀ ਇਸ ਮਸ਼ੀਨ ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਜਾਂਦਾ",
    footZero: "ਸਿਫ਼ਰ ਘੜੇ ਹੋਏ ਮਿਆਰ ਨੰਬਰ", footAudit: "ਹਰ ਕਾਰਵਾਈ ਦਾ ਲੇਖਾ",
    more: "ਹੋਰ", moreNet: "ਸਜੀਵ ਗਿਆਨ ਗ੍ਰਾਫ਼", moreAna: "ਡੂੰਘਾ ਵਿਸ਼ਲੇਸ਼ਣ ਅਤੇ ਵੈਧਤਾ ਨਿਗਰਾਨੀ",
    moreRep: "ਰਿਪੋਰਟ ਡਾਊਨਲੋਡ", moreHis: "ਇਤਿਹਾਸ ਅਤੇ ਆਡਿਟ",
    newTender: "ਨਵਾਂ ਟੈਂਡਰ ਵਿਸ਼ਲੇਸ਼ਣ", browse: "ਮਿਆਰ ਵੇਖੋ", findStandards: "ਮਿਆਰ ਲੱਭੋ",
    working: "ਕੰਮ ਜਾਰੀ…", startNew: "ਨਵਾਂ ਵਿਸ਼ਲੇਸ਼ਣ ਸ਼ੁਰੂ ਕਰੋ", searchPlaceholder: "ਨਾਮ ਨਾਲ ਮਿਆਰ ਲੱਭੋ…",
    verified: "ਤਸਦੀਕਸ਼ੁਦਾ", checking: "ਜਾਂਚ ਲੋੜੀਂਦੀ", example: "ਸਿਰਫ਼ ਉਦਾਹਰਨ",
  },
  kn: {
    overview: "ಅವಲೋಕನ", analyse: "ಟೆಂಡರ್ ವಿಶ್ಲೇಷಣೆ", network: "ಸಂಪರ್ಕಗಳು", standards: "ಮಾನಕ ಪಟ್ಟಿ",
    analytics: "ವಿಶ್ಲೇಷಣೆಗಳು", reports: "ವರದಿ ಡೌನ್‌ಲೋಡ್", history: "ಇತಿಹಾಸ",
    handWelcome: "ನಮಸ್ಕಾರ! ನಿಮಗೆ ಸರಿಯಾದ ಮಾನಕಗಳನ್ನು ಹುಡುಕೋಣ.",
    heroQ1: "ಇಂದು ನೀವು", heroQ2: "ಏನು ಖರೀದಿಸುತ್ತಿದ್ದೀರಿ?",
    heroSubNew: "ನಿಮ್ಮ ಮಾತಿನಲ್ಲೇ ಹೇಳಿ — ಯಾವುದೇ ಭಾರತೀಯ ಭಾಷೆಯಲ್ಲಿ. ಅನ್ವಯವಾಗುವ ಭಾರತೀಯ ಮಾನಕಗಳನ್ನು, ಪ್ರತಿಯೊಂದರ ಹಿಂದೆ ಪುರಾವೆಯೊಂದಿಗೆ ಹುಡುಕುತ್ತೇವೆ.",
    heroPlaceholder: "ನಿಮ್ಮ ಖರೀದಿಯನ್ನು ನಿಮ್ಮ ಮಾತಿನಲ್ಲಿ ಬರೆಯಿರಿ…", tryWord: "ಪ್ರಯತ್ನಿಸಿ:",
    cat1: "ಸುರಕ್ಷತೆ & PPE", cat1s: "ಹೆಲ್ಮೆಟ್, ಬೂಟು, ಕೈಗವಸು.", cat2: "ನಿರ್ಮಾಣ", cat2s: "ಸಿಮೆಂಟ್, ಸ್ಟೀಲ್, ಕಾಂಕ್ರೀಟ್.",
    cat3: "ವಿದ್ಯುತ್", cat3s: "ಕೇಬಲ್, ವೈರಿಂಗ್.", cat4: "ನೀರು & ಆಹಾರ", cat4s: "ಕುಡಿಯುವ ನೀರು, ಪ್ಯಾಕೇಜಿಂಗ್.",
    cat5: "ಕಚೇರಿ & ಶಾಲೆ", cat5s: "ಡೆಸ್ಕ್, ಬೆಂಚ್, ಬೋರ್ಡ್.", cat6: "ಉಳಿದೆಲ್ಲವೂ", cat6s: "೨,೯೦೦+ ಮಾನಕಗಳನ್ನು ನೋಡಿ.",
    journeyTitle: "ನಿಮ್ಮ ವಿಶ್ಲೇಷಣಾ ಪಯಣ", journeyEmpty: "ಇನ್ನೂ ಏನೂ ನಡೆಯುತ್ತಿಲ್ಲ — ಮೇಲೆ ನೀವು ಏನು ಖರೀದಿಸುತ್ತಿದ್ದೀರಿ ಎಂದು ಬರೆಯಿರಿ.",
    openIt: "ತೆರೆಯಿರಿ", j1: "ಟೆಂಡರ್ ಓದಲಾಗಿದೆ", j2: "ವಿವರಗಳು ತೆಗೆಯಲಾಗಿದೆ", j3: "ಮಾನಕಗಳು ಹುಡುಕಲಾಗಿದೆ", j4: "ನಿಮ್ಮ ನಿರ್ಧಾರ",
    jDone: "ಮುಗಿದಿದೆ", jActive: "ನಡೆಯುತ್ತಿದೆ", jWait: "ಕಾಯುತ್ತಿದೆ",
    howTitle: "ಇದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ", howHand: "೧·೨·೩·೪ ರಷ್ಟು ಸುಲಭ",
    flow1t: "ಖರೀದಿಯನ್ನು ವಿವರಿಸಿ", flow1p: "ಕೆಲವು ಸಾಲು ಬರೆಯಿರಿ ಅಥವಾ ಟೆಂಡರ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ — ಸ್ಕ್ಯಾನ್ ಪುಟಗಳೂ ಓದಲ್ಪಡುತ್ತವೆ.",
    flow2t: "ನಾವು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುತ್ತೇವೆ", flow2p: "ಉತ್ಪನ್ನ, ಪ್ರಮಾಣ, ಪರೀಕ್ಷೆ, ಸುರಕ್ಷತೆ — ತೆಗೆದು ನಿಮ್ಮ ದೃಢೀಕರಣಕ್ಕೆ ತೋರಿಸುತ್ತೇವೆ.",
    flow3t: "ಅರ್ಥದಿಂದ ಹುಡುಕುತ್ತೇವೆ", flow3p: "‘ತಲೆ ರಕ್ಷಣೆ’ ಎಂದರೂ ಹೆಲ್ಮೆಟ್ ಮಾನಕಗಳು ಸಿಗುತ್ತವೆ — ಹಲವು ಭಾಷೆಗಳಲ್ಲಿ.",
    flow4t: "ನೀವು ಅನುಮೋದಿಸುತ್ತೀರಿ", flow4p: "ಪ್ರತಿ ಫಲಿತಾಂಶವೂ ತನ್ನ ಪುರಾವೆ ತೋರಿಸುತ್ತದೆ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ಅಂತಿಮವಲ್ಲ.",
    statCatalogue: "ಪಟ್ಟಿಯಲ್ಲಿ ಮಾನಕಗಳು", statInvented: "ಕಲ್ಪಿತ ಮಾನಕ ಸಂಖ್ಯೆಗಳು", statTenders: "ವಿಶ್ಲೇಷಿಸಿದ ಟೆಂಡರ್‌ಗಳು",
    footLang: "೧೦ ಭಾಷೆಗಳು", footLocal: "೧೦೦% ಸ್ಥಳೀಯ AI — ಏನೂ ಈ ಯಂತ್ರದಿಂದ ಹೊರಹೋಗುವುದಿಲ್ಲ",
    footZero: "ಶೂನ್ಯ ಕಲ್ಪಿತ ಮಾನಕ ಸಂಖ್ಯೆಗಳು", footAudit: "ಪ್ರತಿ ಕ್ರಿಯೆಗೂ ಲೆಕ್ಕಪರಿಶೋಧನೆ",
    more: "ಇನ್ನಷ್ಟು", moreNet: "ಸಜೀವ ಜ್ಞಾನ ಗ್ರಾಫ್", moreAna: "ಆಳ ವಿಶ್ಲೇಷಣೆ & ಮಾನ್ಯತೆ ಕಾವಲು",
    moreRep: "ವರದಿ ಡೌನ್‌ಲೋಡ್", moreHis: "ಇತಿಹಾಸ & ಲೆಕ್ಕಪರಿಶೋಧನೆ",
    newTender: "ಹೊಸ ಟೆಂಡರ್ ವಿಶ್ಲೇಷಣೆ", browse: "ಮಾನಕಗಳನ್ನು ನೋಡಿ", findStandards: "ಮಾನಕಗಳನ್ನು ಹುಡುಕಿ",
    working: "ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ…", startNew: "ಹೊಸ ವಿಶ್ಲೇಷಣೆ ಪ್ರಾರಂಭಿಸಿ", searchPlaceholder: "ಹೆಸರಿನಿಂದ ಮಾನಕ ಹುಡುಕಿ…",
    verified: "ಪರಿಶೀಲಿತ", checking: "ಪರಿಶೀಲನೆ ಅಗತ್ಯ", example: "ಉದಾಹರಣೆ ಮಾತ್ರ",
  },
  ml: {
    overview: "അവലോകനം", analyse: "ടെൻഡർ വിശകലനം", network: "ബന്ധങ്ങൾ", standards: "മാനക പട്ടിക",
    analytics: "വിശകലനങ്ങൾ", reports: "റിപ്പോർട്ട് ഡൗൺലോഡ്", history: "ചരിത്രം",
    handWelcome: "നമസ്കാരം! നിങ്ങൾക്ക് ശരിയായ മാനകങ്ങൾ കണ്ടെത്താം.",
    heroQ1: "ഇന്ന് നിങ്ങൾ", heroQ2: "എന്താണ് വാങ്ങുന്നത്?",
    heroSubNew: "നിങ്ങളുടെ വാക്കുകളിൽ പറയൂ — ഏത് ഇന്ത്യൻ ഭാഷയിലും. ബാധകമായ ഇന്ത്യൻ മാനകങ്ങൾ, ഓരോന്നിനും പിന്നിൽ തെളിവോടെ കണ്ടെത്തുന്നു.",
    heroPlaceholder: "നിങ്ങളുടെ വാങ്ങൽ നിങ്ങളുടെ വാക്കുകളിൽ എഴുതൂ…", tryWord: "ശ്രമിക്കൂ:",
    cat1: "സുരക്ഷയും PPE-യും", cat1s: "ഹെൽമെറ്റ്, ബൂട്ട്, കയ്യുറ.", cat2: "നിർമ്മാണം", cat2s: "സിമന്റ്, സ്റ്റീൽ, കോൺക്രീറ്റ്.",
    cat3: "വൈദ്യുതം", cat3s: "കേബിൾ, വയറിംഗ്.", cat4: "വെള്ളവും ഭക്ഷണവും", cat4s: "കുടിവെള്ളം, പാക്കേജിംഗ്.",
    cat5: "ഓഫീസും സ്കൂളും", cat5s: "ഡെസ്ക്, ബെഞ്ച്, ബോർഡ്.", cat6: "ബാക്കിയെല്ലാം", cat6s: "൨,൯൦൦+ മാനകങ്ങൾ കാണൂ.",
    journeyTitle: "നിങ്ങളുടെ വിശകലന യാത്ര", journeyEmpty: "ഇതുവരെ ഒന്നും നടക്കുന്നില്ല — മുകളിൽ നിങ്ങൾ എന്ത് വാങ്ങുന്നുവെന്ന് എഴുതൂ.",
    openIt: "തുറക്കൂ", j1: "ടെൻഡർ വായിച്ചു", j2: "വിവരങ്ങൾ എടുത്തു", j3: "മാനകങ്ങൾ തിരഞ്ഞു", j4: "നിങ്ങളുടെ തീരുമാനം",
    jDone: "പൂർത്തിയായി", jActive: "നടക്കുന്നു", jWait: "കാത്തിരിക്കുന്നു",
    howTitle: "ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നു", howHand: "൧·൨·൩·൪ പോലെ എളുപ്പം",
    flow1t: "വാങ്ങൽ വിവരിക്കൂ", flow1p: "കുറച്ച് വരികൾ എഴുതൂ അല്ലെങ്കിൽ ടെൻഡർ അപ്‌ലോഡ് ചെയ്യൂ — സ്കാൻ പേജുകളും വായിക്കപ്പെടും.",
    flow2t: "ഞങ്ങൾ മനസ്സിലാക്കുന്നു", flow2p: "ഉൽപ്പന്നം, അളവ്, പരിശോധന, സുരക്ഷ — എടുത്ത് നിങ്ങളുടെ സ്ഥിരീകരണത്തിന് കാണിക്കുന്നു.",
    flow3t: "അർത്ഥം കൊണ്ട് തിരയുന്നു", flow3p: "‘തല സംരക്ഷണം’ എന്നെഴുതിയാലും ഹെൽമെറ്റ് മാനകങ്ങൾ കിട്ടും — പല ഭാഷകളിലും.",
    flow4t: "നിങ്ങൾ അംഗീകരിക്കുന്നു", flow4p: "ഓരോ ഫലവും അതിന്റെ തെളിവ് കാണിക്കുന്നു. നിങ്ങളുടെ സമ്മതമില്ലാതെ ഒന്നും അന്തിമമല്ല.",
    statCatalogue: "പട്ടികയിലെ മാനകങ്ങൾ", statInvented: "കെട്ടിച്ചമച്ച മാനക നമ്പറുകൾ", statTenders: "വിശകലനം ചെയ്ത ടെൻഡറുകൾ",
    footLang: "൧൦ ഭാഷകൾ", footLocal: "൧൦൦% പ്രാദേശിക AI — ഒന്നും ഈ യന്ത്രത്തിന് പുറത്തുപോകുന്നില്ല",
    footZero: "പൂജ്യം കെട്ടിച്ചമച്ച മാനക നമ്പറുകൾ", footAudit: "ഓരോ പ്രവൃത്തിക്കും ഓഡിറ്റ്",
    more: "കൂടുതൽ", moreNet: "ചലിക്കുന്ന വിജ്ഞാന ഗ്രാഫ്", moreAna: "ആഴത്തിലുള്ള വിശകലനവും സാധുത നിരീക്ഷണവും",
    moreRep: "റിപ്പോർട്ട് ഡൗൺലോഡ്", moreHis: "ചരിത്രവും ഓഡിറ്റും",
    newTender: "പുതിയ ടെൻഡർ വിശകലനം", browse: "മാനകങ്ങൾ കാണൂ", findStandards: "മാനകങ്ങൾ കണ്ടെത്തൂ",
    working: "പ്രവർത്തിക്കുന്നു…", startNew: "പുതിയ വിശകലനം തുടങ്ങൂ", searchPlaceholder: "പേര് കൊണ്ട് മാനകം തിരയൂ…",
    verified: "പരിശോധിച്ചത്", checking: "പരിശോധന ആവശ്യം", example: "ഉദാഹരണം മാത്രം",
  },
};

const LANGUAGE_NAME: Record<string, string> = { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil", bn: "Bengali", mr: "Marathi", gu: "Gujarati", pa: "Punjabi", kn: "Kannada", ml: "Malayalam" };

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

/** Numbers that count up when they land -- a line of text becomes a moment. */
function useCountUp(target: number, ms = 1000): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min((now - start) / ms, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

function CountStat({ target, caption, note, tone }: { target: number; caption: string; note?: string; tone?: "rust" | "green" }) {
  const value = useCountUp(target);
  return <Stat value={value.toLocaleString("en-IN")} caption={caption} note={note} tone={tone} />;
}

/** The name is the picture: Setu means bridge. A tender document crosses to a
    verified standard, and the moving dashes are the analysis in flight. */
function BridgeScene() {
  return (
    <svg viewBox="0 0 520 300" role="img" aria-label="A tender document crossing a bridge to verified Indian Standards">
      <defs>
        <linearGradient id="ms-sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f7b32b" /><stop offset="1" stopColor="#f1730f" /></linearGradient>
        <linearGradient id="ms-arc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f1730f" /><stop offset="1" stopColor="#8a63e8" /></linearGradient>
      </defs>
      <circle cx="428" cy="58" r="32" fill="url(#ms-sun)" opacity=".9" />
      <g fill="#f2e8d8"><ellipse cx="120" cy="52" rx="36" ry="12" /><ellipse cx="154" cy="61" rx="24" ry="9" /><ellipse cx="330" cy="38" rx="28" ry="10" /></g>
      <path d="M0 252 Q130 236 260 252 T520 252 L520 300 L0 300 Z" fill="#e3edfb" />
      <path d="M0 262 Q170 250 340 262 T520 260 L520 300 L0 300 Z" fill="#d2e2f7" opacity=".8" />
      <path d="M62 246 Q260 92 458 246" fill="none" stroke="url(#ms-arc)" strokeWidth="11" strokeLinecap="round" />
      <g stroke="#c9b8f0" strokeWidth="6" strokeLinecap="round"><line x1="140" y1="212" x2="140" y2="252" /><line x1="260" y1="170" x2="260" y2="256" /><line x1="380" y1="212" x2="380" y2="252" /></g>
      <path className="flow-dash" d="M76 224 Q260 76 444 224" fill="none" stroke="#3b2483" strokeWidth="2.5" opacity=".5" />
      <g className="float-a">
        <rect x="30" y="140" width="76" height="96" rx="10" fill="#fff" stroke="#efe4d3" strokeWidth="2.5" />
        <g stroke="#c9c2df" strokeWidth="4" strokeLinecap="round"><line x1="44" y1="164" x2="92" y2="164" /><line x1="44" y1="182" x2="86" y2="182" /><line x1="44" y1="200" x2="92" y2="200" /><line x1="44" y1="218" x2="74" y2="218" /></g>
        <circle cx="98" cy="148" r="14" fill="#f1730f" /><path d="M92 148 l4 4 l8 -8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="float-b">
        <path d="M448 132 l30 12 v26 c0 20 -13 33 -30 39 c-17 -6 -30 -19 -30 -39 v-26 z" fill="#1d8a5a" />
        <path d="M436 168 l9 9 l18 -18" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="36" y="128" style={{ fontFamily: "var(--hand)" }} fontSize="19" fill="#6f6694">your tender</text>
      <text x="398" y="122" style={{ fontFamily: "var(--hand)" }} fontSize="19" fill="#6f6694">IS standards</text>
    </svg>
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

function Stepper({ analysis, running, t }: { analysis: AnalysisResult | null; running: boolean; t: (key: string) => string }) {
  const done = Boolean(analysis);
  const steps = [
    { label: t("j1"), icon: FileText, done, active: running },
    { label: t("j2"), icon: Sparkles, done: done && analysis!.extracted_requirements.length > 0, active: running },
    { label: t("j3"), icon: Search, done: done && analysis!.recommendations.length > 0, active: running },
    { label: t("j4"), icon: CheckCircle2, done: false, active: done },
  ];
  return (
    <div className="journey-track">
      {steps.map((step, index) => (
        <div key={index} className={`j-step ${step.done ? "done" : step.active ? "active" : ""}`}>
          {index < steps.length - 1 && <span className="j-line" />}
          <span className="j-dot">{step.done ? <Check size={19} /> : <step.icon size={18} />}</span>
          <span className="j-body">
            <strong>{step.label}</strong>
            <span className={`j-pill ${step.done ? "done" : step.active ? "active" : "wait"}`}>
              {step.done ? t("jDone") : step.active ? t("jActive") : t("jWait")}
            </span>
          </span>
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
          <g key={`${e.source}-${e.target}-${i}`} className="net-edge" style={{ animationDelay: `${i * 110}ms` }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={e.dashed ? "#d3ccbe" : "#bdb5a6"} strokeWidth="1.5"
              strokeDasharray={e.dashed ? "5 4" : undefined} markerEnd="url(#arw)" />
            {/* The moving dashes are the graph saying it is alive: evidence
                flowing from the centre outward along every relationship. */}
            {!e.dashed && <line className="net-flow" x1={x1} y1={y1} x2={x2} y2={y2} />}
            {/* A pill behind the label keeps it readable where it crosses the line. */}
            <rect x={mx - width / 2} y={my - 9} width={width} height="17" rx="8.5" fill="#fbf9f6" stroke="#eae5da" strokeWidth="0.8" />
            <text className="net-edge-label" x={mx} y={my + 2.5} textAnchor="middle">{e.label}</text>
          </g>
        );
      })}

      {data.nodes.map((n, index) => {
        const pos = positions[n.id];
        if (!pos) return null;
        const colour = n.is_centre ? NODE_COLOUR.centre : (NODE_COLOUR[n.kind] ?? NODE_COLOUR.standard);
        const r = n.is_centre ? 44 : 30;
        const lines = wrapTitle(n.label);
        return (
          <g key={n.id} className="net-node" style={{ animationDelay: `${(n.is_centre ? 0 : 180) + index * 90}ms` }} onClick={() => onPick(n.id)}>
            {n.is_centre && <circle className="net-halo" cx={pos.x} cy={pos.y} r={r + 11} fill={colour} opacity="0.1" />}
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
  // Distinguishes "the backend refused us" from "the backend is not there at
  // all". A cloud-hosted dashboard pointed at a stopped API must say so
  // plainly rather than showing a sign-in form that can never succeed.
  const [apiReachable, setApiReachable] = useState(true);
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
          .then(profile => { setUser(profile); setApiReachable(true); })
          .catch(error => {
            setUser(null);
            // A TypeError from fetch means the request never reached a server;
            // an HTTP error means it did and said no.
            setApiReachable(!(error instanceof TypeError));
          }),
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
    if (view === "overview") {
      getDashboardStats().then(setStats).catch(() => undefined);
      // The ticker on the landing page scrolls real catalogue records.
      if (!standards.length) getStandards("").then(setStandards).catch(() => undefined);
    }
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

  const [heroQuery, setHeroQuery] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // The hero search IS the product: type anything, in any of the four
  // languages, and the full analysis pipeline runs on it.
  const heroAnalyse = async (description: string, title?: string) => {
    const text = description.trim();
    if (!text || submitting) return;
    startNewAnalysis();
    setMode("text");
    const payload = { title: (title ?? text).slice(0, 80), description: text, language: "en" };
    setForm(payload);
    setSubmitting(true); setFormError("");
    try {
      const result = await analyseTender(payload);
      setAnalysis(result); setApproved(false); setTab("results"); setStage("review"); setView("analyse");
      notify(result.recommendations.length ? `Found ${result.recommendations.length} possible standards` : "No matching standards found");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not analyse that. Please try again.");
      setView("analyse");
    } finally { setSubmitting(false); }
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

  if (!user && !apiReachable) {
    return (
      <main className="offline">
        <div className="offline-card">
          <span className="offline-ico"><PlugZap size={26} /></span>
          <h2>The analysis service is not running</h2>
          <p>
            This is the ManakSetu dashboard. Everything it shows comes from an
            API that does the retrieval, runs the local AI and holds the
            catalogue of {"2,914"} Indian Standards — and that service cannot be
            reached right now.
          </p>
          <p className="offline-why">
            The AI runs entirely on local hardware by design, so the analysis
            service is not hosted in the cloud with this page. Start it, and
            this dashboard connects on reload.
          </p>
          <code className="offline-code">powershell -ExecutionPolicy Bypass -File start-demo.ps1</code>
          <button className="btn btn-primary mt-5" onClick={() => window.location.reload()}>
            <LoaderCircle size={15} /> Try again
          </button>
          <p className="offline-foot">
            Expecting a different address? The dashboard talks to{" "}
            <strong>{process.env.NEXT_PUBLIC_API_URL ?? "this site's own /api/v1"}</strong>
          </p>
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
    <div className="app">
      <header className="topnav">
        <div className="topnav-brand">
          <h1>Manak<em>Setu</em></h1>
          <small>Verified standards intelligence</small>
        </div>
        <nav className="topnav-links" aria-label="Main">
          {nav.filter(n => n.show && PRIMARY_VIEWS.includes(n.id)).map(n => (
            <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => { setView(n.id); setMoreOpen(false); }}>
              <n.icon size={15} />
              <span>{n.label}</span>
              {n.count ? <span className="nav-count">{n.count}</span> : null}
            </button>
          ))}
        </nav>

        {/* Deliberately a sibling of the scrolling nav, not a child of it: an
            absolutely positioned menu inside an overflow:auto container is
            clipped by it, which is what made this invisible on a laptop. */}
        <div className="menu-anchor more-anchor">
          <button
            className={`topnav-more ${!PRIMARY_VIEWS.includes(view) ? "active" : ""}`}
            onClick={() => { setMoreOpen(open => !open); setLangOpen(false); }}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <Sparkles size={15} />
            <span>{t("more")}</span>
            <ChevronDown size={13} style={{ transform: moreOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
          </button>
          {moreOpen && (
            <div className="menu-pop" role="menu">
              {nav.filter(n => n.show && !PRIMARY_VIEWS.includes(n.id)).map(n => (
                <button key={n.id} role="menuitem" className={view === n.id ? "active" : ""} onClick={() => { setView(n.id); setMoreOpen(false); }}>
                  <span className="menu-ico"><n.icon size={16} /></span>
                  <span className="min-w-0">
                    <strong>{n.label}</strong>
                    <small>{t(MORE_DESC[n.id] ?? "")}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="topnav-right">
          <div className="menu-anchor">
            <button
              className="langmenu-btn"
              onClick={() => { setLangOpen(open => !open); setMoreOpen(false); }}
              aria-expanded={langOpen}
              aria-haspopup="menu"
              aria-label="Interface language"
            >
              <Globe2 size={15} />
              <span>{UI_LANGS.find(l => l.code === uiLang)?.native}</span>
              <ChevronDown size={13} style={{ transform: langOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
            </button>
            {langOpen && (
              <div className="menu-pop lang-pop" role="menu">
                {UI_LANGS.map(l => (
                  <button key={l.code} role="menuitem" className={uiLang === l.code ? "active" : ""} onClick={() => { chooseLang(l.code); setLangOpen(false); }}>
                    <span className="menu-ico langmenu-code">{l.label}</span>
                    <span className="min-w-0"><strong>{l.native}</strong></span>
                    {uiLang === l.code && <Check size={15} className="ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="profile-chip"
            title={user.role === "supplier" ? t("signOutSupplier") : t("signOutOfficer")}
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
            <span className="avatar">{user.full_name.split(" ").map(p => p[0]).join("").slice(0, 2)}</span>
            <span className="min-w-0">
              <strong>{user.full_name}</strong>
              <small>{user.role.replaceAll("_", " ")}</small>
            </span>
          </button>
        </div>
      </header>

      {(langOpen || moreOpen) && <button className="menu-scrim" aria-label="Close menu" onClick={() => { setLangOpen(false); setMoreOpen(false); }} />}

      <div className="main">
        <div className="page page-wide">
          {/* ---------------- Overview ---------------- */}
          {view === "overview" && (
            <>
              <section className="hero">
                <div>
                  <span className="hand-note">{t("handWelcome")}</span>
                  <h1>{t("heroQ1")} <span className="spark">{t("heroQ2")}</span></h1>
                  <p className="hero-sub">{t("heroSubNew")}</p>
                  {can(PERMISSIONS.tenderCreate) && (
                    <>
                      <form className="hero-search" onSubmit={e => { e.preventDefault(); heroAnalyse(heroQuery); }}>
                        <Search size={18} className="shrink-0 text-[var(--faint)]" />
                        <input
                          value={heroQuery}
                          onChange={e => setHeroQuery(e.target.value)}
                          placeholder={t("heroPlaceholder")}
                          aria-label={t("heroPlaceholder")}
                        />
                        <button className="go" type="submit" disabled={submitting} aria-label={t("findStandards")}>
                          {submitting ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={20} />}
                        </button>
                      </form>
                      <div className="try-row">
                        <span className="try-word">{t("tryWord")}</span>
                        {TRY_EXAMPLES.map(example => (
                          <button key={example.chip} className="try-chip" onClick={() => heroAnalyse(example.text, example.chip)}>
                            “{example.chip}”
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="hero-art"><BridgeScene /></div>
              </section>

              <div className="cat-grid">
                {CAT_CARDS.map((card, index) => (
                  <button
                    key={card.titleKey}
                    className={`cat-card ${card.cls}`}
                    style={{ animationDelay: `${index * 70}ms` }}
                    onClick={() => card.example ? heroAnalyse(card.example, t(card.titleKey)) : setView("standards")}
                  >
                    <span className="cat-ico"><card.icon size={23} /></span>
                    <strong>{t(card.titleKey)} <ChevronRight size={15} /></strong>
                    <span>{t(card.subKey)}</span>
                  </button>
                ))}
              </div>

              <div className="journey anim-in">
                <div className="journey-head">
                  <h3><Sparkles size={19} /> {t("journeyTitle")}</h3>
                  {analysis && <span className="hand-note">{analysis.tender.title}</span>}
                  <p>{analysis ? `${analysis.tender.reference} · ${new Date(analysis.tender.created_at).toLocaleDateString()}` : t("journeyEmpty")}</p>
                </div>
                <Stepper analysis={analysis} running={submitting} t={t} />
                <div className="journey-cta">
                  {analysis && <button className="btn btn-primary btn-sm" onClick={() => setView("analyse")}>{t("openIt")} <ArrowRight size={14} /></button>}
                  {can(PERMISSIONS.auditRead) && <button className="btn btn-ghost btn-sm" onClick={() => setView("audit")}><History size={14} /> {t("history")}</button>}
                </div>
              </div>

              <div className="mt-10 flex flex-wrap items-baseline gap-4">
                <h3 className="section-head m-0">{t("howTitle")}</h3>
                <span className="hand-note">{t("howHand")}</span>
              </div>
              <div className="flow">
                {[
                  { icon: FileText, title: t("flow1t"), text: t("flow1p") },
                  { icon: Sparkles, title: t("flow2t"), text: t("flow2p") },
                  { icon: Search, title: t("flow3t"), text: t("flow3p") },
                  { icon: CheckCircle2, title: t("flow4t"), text: t("flow4p") },
                ].map((step, index) => (
                  <div key={step.title} className="flow-card" style={{ animationDelay: `${index * 90}ms` }}>
                    <span className="flow-num">{index + 1}</span>
                    <span className="flow-ico"><step.icon size={22} /></span>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                    <span className="flow-arrow"><ArrowRight size={20} /></span>
                  </div>
                ))}
              </div>

              <div className="grid-3 mt-8">
                <CountStat target={totalCount} caption={t("statCatalogue")} note={t("statCatalogueNote")} />
                <Stat value="0" caption={t("statInvented")} tone="green" note={t("statInventedNote")} />
                <CountStat target={stats?.total_tenders ?? 0} caption={t("statTenders")} tone="rust" note={t("statTendersNote")} />
              </div>

              {standards.length > 3 && (
                <div className="ticker-wrap" aria-hidden="true">
                  <div className="ticker">
                    {[...standards.slice(0, 24), ...standards.slice(0, 24)].map((record, index) => (
                      <span key={`${record.id}-${index}`}>
                        <b>{record.standard_number ?? record.catalogue_ref}</b>
                        {record.official_title.slice(0, 44)}{record.official_title.length > 44 ? "…" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="footstrip">
                <span className="hand-note">ManakSetu</span>
                <span><Globe2 size={15} /> {t("footLang")}</span>
                <span><LockKeyhole size={15} /> {t("footLocal")}</span>
                <span><ShieldCheck size={15} /> {t("footZero")}</span>
                <span><History size={15} /> {t("footAudit")}</span>
              </div>
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

              <div className="journey mt-6" style={{ padding: "20px 24px" }}><Stepper analysis={analysis} running={submitting} t={t} /></div>

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
                      {analysis.officer_glance && analysis.officer_glance.length > 0 && (
                        <dl className="glance mt-4">
                          {analysis.officer_glance.map(point => (
                            <div className={`glance-row ${point.tone}`} key={point.label}>
                              <dt>{point.label}</dt>
                              <dd>{point.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
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
              <p className="lede">{totalCount.toLocaleString("en-IN")} records, harvested from the official BIS catalogue. {verifiedCount} checked by a person; the rest carry their official source and say they still need checking. The list shows the first 50 matches — search to narrow it.</p>
              <div className="searchbox mt-5" style={{ maxWidth: 560 }}>
                <Search size={15} />
                <input
                  placeholder={t("searchPlaceholder")}
                  value={standardsQuery}
                  onChange={e => setStandardsQuery(e.target.value)}
                />
              </div>
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
