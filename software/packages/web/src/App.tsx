import { BrowserRouter, Routes, Route } from 'react-router-dom'
import CardPage from './pages/CardPage'
import WritePage from './pages/WritePage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/c/:id" element={<CardPage />} />
        <Route path="/write" element={<WritePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
