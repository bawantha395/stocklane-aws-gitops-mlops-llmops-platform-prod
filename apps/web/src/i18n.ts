import { useSyncExternalStore } from "react";

/** Simple EN / Sinhala switch. The English text is the key; a missing Sinhala line falls back to English. */
export type Lang = "en" | "si";
const KEY = "lifta.lang";
let lang: Lang = (() => { try { return localStorage.getItem(KEY) === "si" ? "si" : "en"; } catch { return "en"; } })();
const subscribers = new Set<() => void>();

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  try { document.documentElement.lang = next; } catch { /* no document */ }
  subscribers.forEach((notify) => notify());
}
export function getLang(): Lang { return lang; }
/** Call in a component so it re-renders when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore((notify) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; }, () => lang);
}
try { document.documentElement.lang = lang; } catch { /* no document */ }

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = (lang === "si" && SI[text]) || text;
  if (vars) for (const k of Object.keys(vars)) out = out.split("{" + k + "}").join(String(vars[k]));
  return out;
}

const SI: Record<string, string> = {
  // Navigation
  "Home": "මුල් පිටුව",
  "WORKSHOP SUITE": "වැඩපළ පද්ධතිය",
  "WORKSHOP MANAGEMENT": "වැඩපළ කළමනාකරණය",
  "STOCK MANAGEMENT": "තොග කළමනාකරණය",
  "Jobs & Invoices": "වැඩ සහ බිල්පත්",
  "Jobs": "වැඩ",
  "Job cards, vehicles and bills": "වැඩ කාඩ්පත්, වාහන සහ බිල්පත්",
  "Parts counter": "කොටස් කවුන්ටරය",
  "Counter": "කවුන්ටරය",
  "Receive or give a part": "කොටසක් ගන්න හෝ දෙන්න",
  "Parts list": "කොටස් ලැයිස්තුව",
  "Parts": "කොටස්",
  "All parts, photos and QR labels": "සියලු කොටස්, ෆොටෝ සහ QR ලේබල්",
  "See what is in stock": "තොගයේ ඇති දේ බලන්න",
  "History": "ඉතිහාසය",
  "Every part in and out": "කොටස් ඇතුළු වූ සහ පිටවූ හැම දෙයක්ම",
  "Reports": "වාර්තා",
  "Stock summary and low stock": "තොග සාරාංශය සහ අඩු තොග",
  "Menu": "මෙනුව",
  "Owner workspace": "හිමිකරුගේ වැඩ කොටස",
  "Stock team": "තොග කණ්ඩායම",
  "Sign out": "ඉවත් වන්න",
  "Sign in": "ඇතුළු වන්න",
  "Something needs your attention": "ඔබේ අවධානය අවශ්‍යයි",
  // Home
  "YOUR WORKSHOP. UNDER CONTROL.": "ඔබේ වැඩපළ. ඔබේ පාලනයෙන්.",
  "What are we doing today?": "අද අපි මොකක්ද කරන්නේ?",
  "Pick what you want to do. New here? Follow the steps below.": "කරන්න ඕන දේ තෝරන්න. අලුත්ද? පහත පියවර අනුගමනය කරන්න.",
  "GET STARTED": "ආරම්භ කරන්න",
  "{done} of {total} done": "{done} / {total} අවසන්",
  "Hide": "සඟවන්න",
  "Add your business details": "ව්‍යාපාර විස්තර ඇතුළත් කරන්න",
  "Name, address and phone for your bills.": "බිල්පත් සඳහා නම, ලිපිනය සහ දුරකථන අංකය.",
  "Add your first part": "පළමු කොටස ඇතුළත් කරන්න",
  "Take a photo of a part. Lifta reads the label.": "කොටසක ෆොටෝ එකක් ගන්න. Lifta ලේබලය කියවයි.",
  "Start your first job": "පළමු වැඩය ආරම්භ කරන්න",
  "One vehicle, its repairs, parts and labour.": "එක් වාහනයක්, එහි අලුත්වැඩියා, කොටස් සහ ශ්‍රමය.",
  "Make your first invoice": "පළමු බිල්පත සාදන්න",
  "Open a job and press Create invoice.": "වැඩයක් විවෘත කර \"බිල්පත සාදන්න\" ඔබන්න.",
  "Do this": "මෙය කරන්න",
  "Open": "විවෘත කරන්න",
  "WORKSHOP": "වැඩපළ",
  "STOCK": "තොගය",
  "Start a job": "වැඩයක් අරඹන්න",
  "A vehicle comes in for work": "වාහනයක් වැඩට ආවා",
  "Invoices": "බිල්පත්",
  "Open a bill or take a payment": "බිලක් විවෘත කරන්න හෝ ගෙවීමක් ගන්න",
  "Receive": "ලබා ගන්න",
  "Scan or photo what came in": "ආපු දේ ස්කෑන් කරන්න හෝ ෆොටෝ ගන්න",
  "Give a part": "කොටසක් දෙන්න",
  "Scan the part and confirm the quantity": "කොටස ස්කෑන් කර ප්‍රමාණය තහවුරු කරන්න",
  "Find a part": "කොටසක් සොයන්න",
  "Look up a part, photo or shelf.": "කොටසක්, ෆොටෝ එකක් හෝ රාක්කයක් සොයන්න.",
  "Search stock": "තොගය සොයන්න",
  "Count stock": "තොගය ගණන් කරන්න",
  "Compare a physical count with your records.": "ඇත්ත ගණන වාර්තා සමඟ සසඳන්න.",
  "Check a quantity": "ප්‍රමාණයක් පරීක්ෂා කරන්න",
  "Continue where you left off": "නතර කළ තැනින් දිගටම කරන්න",
  // Parts list empty states
  "No parts yet": "තවම කොටස් නැහැ",
  "No matching items": "ගැලපෙන දේවල් නැහැ",
  "Try the manufacturer part number.": "නිෂ්පාදකයාගේ කොටස් අංකය උත්සාහ කරන්න.",
  "This is the list of every part you keep. Go to the Parts counter, take a photo of a part and Lifta reads the label. Then print its QR label.": "මෙය ඔබ තබාගන්නා හැම කොටසකම ලැයිස්තුවයි. කොටස් කවුන්ටරයට ගොස් කොටසක ෆොටෝ එකක් ගන්න, Lifta ලේබලය කියවයි. ඉන්පසු එහි QR ලේබලය මුද්‍රණය කරන්න.",
  // Counter
  "Which part came in?": "ආවේ මොන කොටසද?",
  "Which part?": "මොන කොටසද?",
  "Part no.": "කොටස් අංකය",
  "System no.": "පද්ධති අංකය",
  "Not set": "සකසා නැහැ",
  "in stock": "තොගයේ ඇත",
  "Change": "වෙනස් කරන්න",
  "Open camera": "කැමරාව විවෘත කරන්න",
  "Checking the photo…": "ෆොටෝ එක පරීක්ෂා කරමින්…",
  "Scan a Lifta QR or original product barcode. You can also take a photo or search manually.": "Lifta QR එකක් හෝ නිෂ්පාදනයේ බාර්කෝඩ් එක ස්කෑන් කරන්න. ෆොටෝ එකක් ගන්න, නැත්නම් අතින් සොයන්න.",
  "Is it one of these?": "මේවායින් එකක්ද?",
  "Reading the label…": "ලේබලය කියවමින්…",
  "None of these: add as a new item": "මේවා නෙවෙයි: අලුත් අයිතමයක් ලෙස එකතු කරන්න",
  "Add as a new item (reads the label)": "අලුත් අයිතමයක් ලෙස එකතු කරන්න (ලේබලය කියවයි)",
  "Or search": "නැත්නම් සොයන්න",
  "How many?": "කීයද?",
  "litres": "ලීටර්",
  "pieces": "කෑලි",
  "No recipient details are required. Confirm the quantity leaving the storeroom.": "ලබන්නාගේ විස්තර අවශ්‍ය නැහැ. ගබඩාවෙන් පිටවන ප්‍රමාණය තහවුරු කරන්න.",
  "Saving…": "සුරකිමින්…",
  "Add {q} × {name} to stock": "{q} × {name} තොගයට එකතු කරන්න",
  "Record {q} × {name} leaving stock": "{q} × {name} තොගයෙන් පිටවූ බව සටහන් කරන්න",
  "Recorded: {q} × {name} added to stock.": "සටහන් කළා: {q} × {name} තොගයට එකතු විය.",
  "Recorded: {q} × {name} taken out.": "සටහන් කළා: {q} × {name} පිටතට ගත්තා.",
  "Scan another item": "තවත් අයිතමයක් ස්කෑන් කරන්න",
  "Could not complete that action": "එම ක්‍රියාව සම්පූර්ණ කළ නොහැකි විය",
  "This QR is not a stock item. Take a photo of the part instead.": "මෙම QR එක තොග අයිතමයක් නෙවෙයි. ඒ වෙනුවට කොටසේ ෆොටෝ එකක් ගන්න.",
  "No match from the photo. Search below, or add it as a new item.": "ෆොටෝ එකෙන් ගැලපෙන දෙයක් නැහැ. පහතින් සොයන්න, නැත්නම් අලුත් අයිතමයක් ලෙස එකතු කරන්න.",
  "No match from the photo. Search for the part below.": "ෆොටෝ එකෙන් ගැලපෙන දෙයක් නැහැ. පහතින් කොටස සොයන්න.",
  "Barcode found externally. Review the suggested details manually before registering.": "බාර්කෝඩ් එක පිටත දත්තවල හමුවුණා. ලියාපදිංචි කිරීමට පෙර යෝජිත විස්තර බලන්න.",
  "Barcode {code} is not in the catalogue. Enter the item details manually.": "බාර්කෝඩ් {code} ලැයිස්තුවේ නැහැ. අයිතම විස්තර අතින් ඇතුළත් කරන්න.",
  "No part matches \"{q}\".": "\"{q}\" ට ගැලපෙන කොටසක් නැහැ.",
  // Camera
  "Close": "වසන්න",
  "CAMERA": "කැමරාව",
  "Scan a QR or product barcode": "QR එකක් හෝ බාර්කෝඩ් එකක් ස්කෑන් කරන්න",
  "QR and product barcodes are detected automatically.": "QR සහ බාර්කෝඩ් ඉබේම හඳුනා ගනී.",
  "Barcode reader ready. Point at an EAN, UPC or Code 128 barcode.": "බාර්කෝඩ් කියවනය සූදානම්. බාර්කෝඩ් එක දෙසට යොමු කරන්න.",
  "This browser does not support live barcodes. Use a QR label or take a photo.": "මෙම බ්‍රව්සරය සජීවී බාර්කෝඩ් සඳහා සහාය නොදක්වයි. QR ලේබලයක් භාවිතා කරන්න, නැත්නම් ෆොටෝ එකක් ගන්න.",
  "Take photo": "ෆොටෝ ගන්න",
  "Choose a photo from this device": "මෙම උපාංගයෙන් ෆොටෝ එකක් තෝරන්න",
  "The camera could not start. Allow camera access for this site, or choose a photo from this device.": "කැමරාව ආරම්භ කළ නොහැකි විය. මෙම අඩවියට කැමරා ප්‍රවේශය ලබා දෙන්න, නැත්නම් උපාංගයෙන් ෆොටෝ එකක් තෝරන්න.",
  "The photo could not be taken. Try again.": "ෆොටෝ එක ගත නොහැකි විය. නැවත උත්සාහ කරන්න.",
};
