"""Build the shared OpenAI-compatible chat messages with LangChain Core."""
from langchain_core.messages import convert_to_openai_messages
from langchain_core.prompts import ChatPromptTemplate


_CHAT_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "{system_prompt}"),
    ("human", "{user_prompt}"),
])


def chat_messages(system_prompt, user_prompt):
    messages = _CHAT_PROMPT.format_messages(system_prompt=system_prompt, user_prompt=user_prompt)
    return convert_to_openai_messages(messages)
