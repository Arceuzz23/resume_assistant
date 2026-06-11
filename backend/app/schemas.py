from pydantic import BaseModel, Field
from typing import Literal, List, Optional

# Incoming request for the /chat endpoint
class ChatRequest(BaseModel):
    session_id: str
    query: str
    model: str

# Outgoing response for the /chat endpoint
class AssistantResponse(BaseModel):
    answer: str
    confidence: float = Field(ge=0.0, le=1.0)
    source: Literal["resume", "inference"]
    missing_data: List[str] = []