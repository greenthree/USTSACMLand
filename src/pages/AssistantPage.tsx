import BotMessageSquare from 'lucide-react/dist/esm/icons/bot-message-square'
import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import { ChatRuntime } from '../features/chat/ChatRuntime'
import '../features/chat/chat.css'

export function AssistantPage() {
  return (
    <div className="assistant-page">
      <section className="assistant-intro" aria-labelledby="assistant-title">
        <div className="assistant-intro-copy">
          <p className="assistant-kicker">USTS ACM · AI LEARNING DESK</p>
          <h1 id="assistant-title">
            把卡住你的地方，
            <span>放到桌面上。</span>
          </h1>
          <p>
            用对话拆解题意、验证思路、调试代码与复盘训练。这里不是答案机器，而是一张帮助你把问题想清楚的算法工作台。
          </p>
        </div>
        <div className="assistant-intro-notes">
          <article>
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>赛中不用 AI</strong>
              <span>训练时用 AI 理清思路；正式算法竞赛期间请独立完成。</span>
            </div>
          </article>
          <article>
            <BotMessageSquare size={20} aria-hidden="true" />
            <div>
              <strong>MVP 临时会话</strong>
              <span>刷新页面会清空当前对话，本阶段不提供聊天历史。</span>
            </div>
          </article>
          <article>
            <KeyRound size={20} aria-hidden="true" />
            <div>
              <strong>不要提交秘密</strong>
              <span>请勿发送密码、Cookie、密钥、个人隐私或未公开代码。</span>
            </div>
          </article>
        </div>
      </section>

      <ChatRuntime />
    </div>
  )
}
