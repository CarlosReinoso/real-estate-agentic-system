GRADE_DOCUMENT_SYSTEM = """You are a grader assessing relevance of a retrieved document to a user question.
If the document contains keyword(s) or semantic meaning related to the user question, grade it as relevant.
It does not need to be a stringent test. The goal is to filter out erroneous retrievals."""

GRADE_DOCUMENT_HUMAN = """User question (with optional task context):

{question}

Retrieved document:

{document}

Give a binary score 'yes' or 'no' to indicate whether the document is relevant to the question."""

TRANSFORM_QUERY = """You are a question re-writer. Given an input question, rewrite it to improve
vector search over legal / commercial real estate documents. The rewritten question should be standalone.

Conversation / task context (may be empty):
{context}

Original question:
{question}

{retry_section}

Output a single improved search question (no bullets, no quotes). Do not answer the question."""

RETRY_SECTION = """Previous retrieval returned no relevant passages. Brief diagnosis:
{grade_notes}

Rewrite the question to improve recall and relevance."""
