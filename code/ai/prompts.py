"""用 LangChain Core 构造共用的 OpenAI 兼容聊天消息。"""
from langchain_core.messages import convert_to_openai_messages
from langchain_core.prompts import ChatPromptTemplate


_CHAT_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "{system_prompt}"),
    ("human", "{user_prompt}"),
])


def chat_messages(system_prompt, user_prompt):
    """生成传输用的消息列表，保持系统指令和待分析材料的角色边界。

    提示词通过占位符作为值填入。源码或 JSON 自带的花括号会原样保留，
    不会被模板再次解析。适配器把 LangChain 的 human 角色转成 user。
    """
    messages = _CHAT_PROMPT.format_messages(system_prompt=system_prompt, user_prompt=user_prompt)
    return convert_to_openai_messages(messages)
