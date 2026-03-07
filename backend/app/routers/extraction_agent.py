from langchain_openai import ChatOpenAI
from .tools import ExtractionAgentTools
from langchain.agents import create_agent
from langgraph.checkpoint.memory import InMemorySaver as MemorySaver
from dotenv import load_dotenv
from .prompts import Prompts
from datetime import datetime
from .schema import StructuredDocument
import os

class StructuredExtractionAgent:
    def __init__(self, tools, model_name="google/gemini-2.0-flash-001"):
        load_dotenv()
        api_key = os.getenv('OPENROUTER_API_KEY')
        
        if not api_key:
            raise ValueError("API key not set. Please set the OPENROUTER_API_KEY environment variable.")
      
        # 1. Initialize the Base Model
        self.base_llm = ChatOpenAI(
            model=model_name.strip(),
            api_key=api_key,
            openai_api_base="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Structured Document Extraction Engine"
            },
            temperature=0
        )

        self.structured_llm = self.base_llm.with_structured_output(StructuredDocument)
        self.tools = tools
        self.system_prompt = Prompts.get_prompt()
        self.checkpointer = MemorySaver()
        

        self.agent = self.get_agent()

    def get_agent(self):
        # The agent needs the base_llm to handle tools and conversation
        return create_agent(
            model=self.base_llm, 
            tools=self.tools,
            system_prompt=self.system_prompt, 
            checkpointer=self.checkpointer
        )

    def clear_memory(self, thread_id: str):
        """
        Manually clears the conversation history for a specific thread
        without changing the ID.
        """
        config = {"configurable": {"thread_id": thread_id}}
        
        # We update the state with an empty list of messages.
        # In LangGraph, passing an empty list to the 'messages' key 
        # effectively resets the conversation for that thread.
        self.agent.update_state(
            config,
            {"messages": []}, # Overwrite with empty history
            as_node="__start__" # Tells LangGraph to treat this as a fresh start
        )
        return f"Memory for thread {thread_id} has been cleared."

    def ask(self, query: str, thread_id: str):
        config = {"configurable": {"thread_id": thread_id}}
        
        # 1. Prepare context (Time/Date)
        now = datetime.now()
        # current_dt = now.strftime('%Y-%m-%d %H:%M')
        context_instruction = (
            f"CRITICAL: The current reference time is {now.strftime('%H:%M')} "
            f"on {now.strftime('%Y-%m-%d')}. All relative mentions like 'ten minutes ago' "
            "must be calculated from THIS specific timestamp."
        )
        # 2. Retrieve existing memory from the checkpointer
        state = self.agent.get_state(config)
        # If messages exist in the state, use them; otherwise, start fresh
        messages = state.values.get("messages", []) if state.values else []
        
        # 3. Build the full conversation chain for the LLM
        # We include the System Prompt + History + Current Query
        full_query = [
            ("system", self.system_prompt + "\n\n" + context_instruction)
        ]
        full_query.extend(messages) # Add history
        full_query.append(("user", query)) # Add new input

        # 4. Invoke the structured model
        result = self.structured_llm.invoke(full_query)
        
        # 5. SAVE the turn back to the checkpointer
        # This is crucial so Phase 3 remembers Phase 2
        self.agent.update_state(
            config,
            {"messages": [("user", query), ("assistant", result.model_dump_json())]}
        )
        return result.model_dump_json()