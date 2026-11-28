//! The language a judge writes its reason in: the language of the question.
//!
//! Small models asked to "write in the language of the question" drift to the language of
//! the examples they were given (an English question got Indonesian reasons on gpt-4o-mini).
//! The judge is told the language by name instead. The app speaks English and Indonesian, so
//! those two are recognised from common words; for anything else the judge is asked to
//! follow the question.

/// Words that mark an Indonesian sentence (and are not English words).
const INDONESIAN_WORDS: &[&str] = &[
    "apa",
    "apakah",
    "ada",
    "berapa",
    "bisa",
    "boleh",
    "buka",
    "tutup",
    "harga",
    "kapan",
    "dimana",
    "di",
    "ke",
    "dari",
    "yang",
    "dan",
    "untuk",
    "dengan",
    "tidak",
    "nggak",
    "gak",
    "saya",
    "aku",
    "kamu",
    "anda",
    "kak",
    "mau",
    "pesan",
    "kirim",
    "ongkir",
    "gratis",
    "jam",
    "hari",
    "ini",
    "itu",
    "sudah",
    "belum",
    "bagaimana",
    "gimana",
    "kenapa",
    "mengapa",
    "siapa",
    "juga",
    "atau",
    "tolong",
    "terima",
    "kasih",
    "berapaan",
    "jual",
    "beli",
    "bayar",
    "bisakah",
    "sampai",
    "kue",
    "roti",
];

/// Words that mark an English sentence (and are not Indonesian words).
const ENGLISH_WORDS: &[&str] = &[
    "the", "a", "an", "is", "are", "do", "does", "you", "your", "what", "when", "where", "how", "much", "many", "can",
    "could", "i", "we", "it", "of", "to", "for", "and", "or", "with", "open", "price", "cost", "have", "sell",
    "deliver", "delivery", "free", "order", "my", "me", "there", "this", "that", "please", "will", "would", "which",
    "who", "why", "cake", "hours", "today", "tomorrow",
];

/// The language to write a judge's reason in for `question`: `English`, `Indonesian`, or
/// "the language the question is written in" when neither is clear.
pub fn reason_language(question: &str) -> &'static str {
    let mut indonesian = 0usize;
    let mut english = 0usize;
    for word in question.split(|character: char| !character.is_alphabetic()).filter(|word| !word.is_empty()) {
        let word = word.to_lowercase();
        if INDONESIAN_WORDS.contains(&word.as_str()) {
            indonesian += 1;
        }
        if ENGLISH_WORDS.contains(&word.as_str()) {
            english += 1;
        }
    }
    match indonesian.cmp(&english) {
        std::cmp::Ordering::Greater => "Indonesian (Bahasa Indonesia)",
        std::cmp::Ordering::Less => "English",
        std::cmp::Ordering::Equal => "the language the question is written in",
    }
}

#[cfg(test)]
mod tests {
    use super::reason_language;

    #[test]
    fn english_and_indonesian_questions_are_told_apart() {
        for question in [
            "Can I place an order for delivery?",
            "How much does a chocolate cake cost?",
            "What are your opening hours?",
            "Is delivery free in Bandung?",
            "Do you sell croissants?",
        ] {
            assert_eq!(reason_language(question), "English", "{question}");
        }
        for question in [
            "Berapa harga kue coklat?",
            "Jam berapa toko buka?",
            "Apakah ongkir ke Bandung gratis?",
            "Kak, bisa pesan untuk besok?",
            "Ada roti tawar?",
        ] {
            assert_eq!(reason_language(question), "Indonesian (Bahasa Indonesia)", "{question}");
        }
    }

    #[test]
    fn other_languages_follow_the_question() {
        assert_eq!(reason_language("¿Cuánto cuesta el pastel?"), "the language the question is written in");
        assert_eq!(reason_language(""), "the language the question is written in");
    }
}
