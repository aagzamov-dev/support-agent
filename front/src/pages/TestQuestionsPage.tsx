import { useState } from 'react';

const TEST_DATA = [
  {
    category: "Help Desk",
    focus: "General IT support, software troubleshooting, hardware issues.",
    questions: [
      { q: "My laptop is running extremely slow after the latest Windows update. What should I do?", a: "Ticket created. Agent may suggest IT tips (restart, etc.) or escalate." },
      { q: "I can't get VS Code to open on my machine. It just bounces in the dock and then closes.", a: "Ticket created for Help Desk team." },
      { q: "The printer on the 3rd floor is showing an 'Error 404' on its display and won't print my documents.", a: "Ticket created for Help Desk team." },
      { q: "I accidentally deleted some important files from my desktop, can you help me recover them?", a: "Ticket created for Help Desk team." },
      { q: "My monitor is flickering and showing green lines across the screen. Is it a hardware failure?", a: "Ticket created for Help Desk team." }
    ]
  },
  {
    category: "DevOps",
    focus: "Deployments, infrastructure, CI/CD pipelines, cloud resources.",
    questions: [
      { q: "The production deployment failed with a 500 error during the database migration step.", a: "Ticket created for DevOps team." },
      { q: "I need to increase the memory limit for the microservices running in the staging Kubernetes cluster.", a: "Ticket created for DevOps team." },
      { q: "Our Jenkins pipeline is stuck on the 'Build' stage for over 30 minutes. Can you check the worker nodes?", a: "Ticket created for DevOps team." },
      { q: "Can you provide the latest AWS S3 bucket policy for the public assets folder?", a: "Ticket created for DevOps team." },
      { q: "We are seeing high CPU usage on the main application server. Should we scale up the instance?", a: "Ticket created for DevOps team." }
    ]
  },
  {
    category: "Network",
    focus: "Connectivity, VPN, Wi-fi, DNS, Firewall.",
    questions: [
      { q: "I'm having trouble connecting to the corporate VPN from my home network. It says 'Connection Timeout'.", a: "Ticket created for Network team." },
      { q: "The Wi-Fi in the conference room 'Alpha' is very unstable and keeps dropping.", a: "Ticket created for Network team." },
      { q: "I can't access any websites; it seems like my DNS resolution is completely broken.", a: "Ticket created for Network team." },
      { q: "Our external clients are reporting that they cannot reach our API endpoint. Is there a firewall block?", a: "Ticket created for Network team." },
      { q: "I need to request a static IP address for my development workstation.", a: "Ticket created for Network team." }
    ]
  },
  {
    category: "Sales & Licensing",
    focus: "Pricing, software licenses, quotes, account upgrades.",
    questions: [
      { q: "How much does the Enterprise subscription cost for a team of 50 people?", a: "Ticket created for Sales & Licensing team." },
      { q: "Our license for the design software is about to expire. How do we renew it for another year?", a: "Ticket created for Sales & Licensing team." },
      { q: "I want to upgrade my account from Basic to Professional. Can you send me a quote?", a: "Ticket created for Sales & Licensing team." },
      { q: "We are a non-profit organization. Do you offer any special discounts on your annual plans?", a: "Ticket created for Sales & Licensing team." },
      { q: "I received an invoice yesterday but the amount seems incorrect. Who can I talk to about billing?", a: "Ticket created for Sales & Licensing team." }
    ]
  },
  {
    category: "Security",
    focus: "Suspicious activity, phishing, access control, password resets.",
    questions: [
      { q: "I just received a very suspicious email asking for my login credentials. I think it's a phishing attempt.", a: "Ticket created for Security team." },
      { q: "I've lost my physical MFA security key. How can I get a replacement and lock my account?", a: "Ticket created for Security team." },
      { q: "I noticed an unrecognized login to my account from a location I've never been to. Please investigate.", a: "Ticket created for Security team." },
      { q: "I need to grant temporary read-only access to our database for a 3rd party auditor. What's the protocol?", a: "Ticket created for Security team." },
      { q: "I suspect one of our public-facing servers has been compromised. What are the immediate isolation steps?", a: "Ticket created for Security team." }
    ]
  },
  {
    category: "Auto-Close (Resolve) Tests",
    focus: "Agent should detect thank-you / confirmation and auto-resolve the ticket.",
    questions: [
      { q: "Thanks, it works now!", a: "Ticket status → resolved, agent says goodbye." },
      { q: "Thank you so much for the help!", a: "Ticket status → resolved." },
      { q: "OK done, everything is fixed", a: "Ticket status → resolved." },
      { q: "Did you fix it?", a: "(This is a QUESTION) Ticket stays open, agent should NOT resolve." },
      { q: "Is it working now?", a: "(This is a QUESTION) Ticket stays open." }
    ]
  },
  {
    category: "General Hints vs Company-Specific",
    focus: "AI should give simple hints for general IT issues but refuse to hallucinate company data.",
    questions: [
      { q: "How do I speed up my slow PC?", a: "Give 2-3 simple tips (clear cache, restart, etc.) + 'If not helped, Admin will follow up'." },
      { q: "How do I clear browser cache?", a: "Give clear step-by-step instructions." },
      { q: "What is our company refund policy?", a: "\"I don't have that information. Admin will follow up shortly.\"" },
      { q: "How do I access the internal HR portal?", a: "Should NOT hallucinate a URL. Say admin will help." }
    ]
  },
  {
    category: "Chitchat & Escalation",
    focus: "Greetings should not create tickets. Frustrated users should be escalated.",
    questions: [
      { q: "Hello", a: "Polite greeting, asks how to help. No ticket created." },
      { q: "Hi, how are you?", a: "Polite greeting. No ticket created." },
      { q: "I'm SO ANGRY, this is the 5th time I'm reporting this! I want to speak to a manager NOW!", a: "Escalation flag set, empathetic response." },
      { q: "OUR ENTIRE SERVER IS DOWN! CRITICAL PRODUCTION OUTAGE!", a: "P1 priority assigned, immediate escalation." }
    ]
  },
  {
    category: "Knowledge Base (RAG) Tests",
    focus: "AI should correctly parse and answer questions specifically from uploaded KB documents (PDF and JSON).",
    questions: [
      { q: "What is the maximum discount I can offer on a standard plan?", a: "\"You can offer up to a 5% discount on standard plans without manager approval.\"" },
      { q: "I'm trying to close an Enterprise deal for $60k. Are there any SLAs I can include?", a: "Yes, for clients over $50k MRR, you should involve a Senior Account Executive and you can offer a complimentary 12-month SLA." },
      { q: "Is there a promo code for Black Friday?", a: "Yes, during November 2026 you can offer an automatic 20% discount using the code BF2026-AUTOWIN." },
      { q: "A prospect is complaining that our premium support is too expensive. What should I say?", a: "Emphasize our 99.99% uptime guarantee. You are also authorized to provide a one-time 15% discount code: SAVE15B2B." },
      { q: "If I close a multi-year contract, what is my commission?", a: "Multi-year contracts receive an upfront 12% commission." }
    ]
  }
];

export default function TestQuestionsPage() {
    const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(id);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 40 }}>
            <div className="mb-4">
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>🧪 AI Test Questions</h1>
                <p className="text-muted">
                    Use these questions to test the AI Support Agent's capabilities. Click the "Copy" button next to any question to quickly paste it into the User Chat.
                </p>
            </div>

            <div className="flex-col gap-4">
                {TEST_DATA.map((section, sIndex) => (
                    <div key={sIndex} className="card" style={{ padding: 20 }}>
                        <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent)' }}>{section.category}</h2>
                            <p className="text-sm text-muted" style={{ marginTop: 4 }}><em>Focus: {section.focus}</em></p>
                        </div>
                        
                        <div className="flex-col gap-3">
                            {section.questions.map((item, qIndex) => {
                                const id = `${sIndex}-${qIndex}`;
                                return (
                                    <div key={qIndex} style={{ 
                                        padding: 12, 
                                        background: 'var(--bg-input)', 
                                        borderRadius: 'var(--radius-sm)', 
                                        border: '1px solid var(--border)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 8
                                    }}>
                                        <div className="flex items-start justify-between gap-4">
                                            <div style={{ fontWeight: 500, fontSize: '0.95rem' }}>
                                                {item.q}
                                            </div>
                                            <button 
                                                className={`btn btn-sm ${copiedIndex === id ? 'btn-success' : 'btn-secondary'}`}
                                                style={{ whiteSpace: 'nowrap' }}
                                                onClick={() => handleCopy(item.q, id)}
                                            >
                                                {copiedIndex === id ? '✅ Copied!' : '📋 Copy'}
                                            </button>
                                        </div>
                                        <div className="text-sm" style={{ padding: '8px 12px', background: 'var(--bg-dark)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--success)' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>✅ Expected: </span>
                                            <span style={{ color: 'var(--text)' }}>{item.a}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
