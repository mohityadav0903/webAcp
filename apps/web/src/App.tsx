import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { WebacpChat } from '@webacp/ui';
import { webConfig } from './config.js';

function ChatPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();

  return (
    <WebacpChat
      baseUrl={webConfig.baseUrl}
      agentPairUrl={webConfig.agentPairUrl}
      brand={{ title: 'WebACP', subtitle: 'context OS chat' }}
      className="h-screen"
      threadId={threadId}
      onThreadChange={(id) => navigate(id ? `/chat/${id}` : '/')}
    />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:threadId" element={<ChatPage />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
