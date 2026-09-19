"""Words that carry no procurement meaning.

Shared by retrieval and by subject detection. It lives on its own so that
subject.py can use it without importing recommendation.py, which imports
requirements.py, which imports subject.py.
"""

STOP_WORDS = {
    # articles, pronouns, prepositions, conjunctions
    "a", "about", "above", "after", "again", "against", "all", "along", "also", "among", "and",
    "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between",
    "both", "but", "by", "can", "does", "each", "either", "etc", "for", "from", "further",
    "had", "has", "have", "he", "her", "here", "his", "how", "however", "if", "in", "into",
    "is", "it", "its", "may", "more", "most", "must", "no", "nor", "not", "of", "off", "on",
    "once", "only", "or", "other", "our", "out", "over", "own", "per", "same", "shall",
    "she", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then",
    "there", "these", "they", "this", "those", "through", "to", "too", "under", "until",
    "up", "very", "was", "were", "what", "when", "where", "which", "while", "who", "whom",
    "why", "will", "with", "within", "would", "you", "your",
    # tender and contract boilerplate: present in every document, so it
    # distinguishes none of them
    "accordance", "acceptance", "accepted", "annexure", "applicable", "approval", "approved",
    "authority", "bid", "bidder", "bidders", "bids", "case", "clause", "company", "concerned",
    "condition", "conditions", "contract", "date", "delivery", "department", "detail",
    "details", "document", "documents", "due", "following", "given", "government", "included",
    "including", "items", "made", "make", "notice", "number", "offer", "offered", "order",
    "page", "part", "party", "payment", "period", "prescribed", "price", "provided",
    "purchase", "purchaser", "quantity", "quoted", "rate", "rates", "received", "regarding",
    "required", "requirement", "requirements", "respect", "said", "schedule", "section",
    "shall", "specified", "sub", "subject", "submission", "submitted", "supplied", "supply",
    "tender", "tenderer", "terms", "time", "total", "units", "value", "work", "works",
}
