/**
 * First-week tips. Delivered as proactive messages by the scheduler,
 * each with a phone-sized illustration of the feature and a tap-to-try action.
 */
export const TIPS = [
  {
    title: "I remember what matters to you",
    body: "Tell me about the people, plans and preferences in your life and I'll keep them in mind, across every chat. You can see and edit what I know any time in the Identity tab.",
    choice: "What do you remember about me?",
    image: "tips/memory.jpg",
  },
  {
    title: "I keep working after you close the app",
    body: "Ask me to remind you, check a price, or watch for something. I run quietly in the background and only ping you when it's worth it.",
    choice: "Remind me tomorrow at 9am to stretch",
    image: "tips/reminders.jpg",
  },
  {
    title: "Turn a goal into a plan",
    body: "Give me something you want to make happen and I'll break it into steps, track your progress and nudge you along the way.",
    choice: "Help me set a goal",
    image: "tips/goals.jpg",
  },
  {
    title: "I can use a browser for you",
    body: "I can open sites, compare options and fill in the boring parts. You can watch live, take over any time, and I'll ask before anything that matters.",
    choice: "Find me a good brunch spot nearby",
    image: "tips/browser.jpg",
  },
  {
    title: "Spaces are little apps made for you",
    body: "Ask for a tracker, planner or dashboard and I'll build it as a space you can pin. It keeps its data and I can refresh it for you.",
    choice: "Build me a gift tracker",
    image: "tips/spaces.jpg",
  },
  {
    title: "You can just talk to me",
    body: "Tap Call at the top for a hands-free conversation. I listen, answer out loud, and keep going until you hang up.",
    choice: "How does a call work?",
    image: "tips/voice.jpg",
  },
  {
    title: "I make things, not just answers",
    body: "Pages, PDFs, checklists, podcasts and more, right here in the chat. If something grows into a bigger project, we can give it its own side chat.",
    choice: "Make me a weekend plan page",
    image: "tips/make.jpg",
  },
];

export function tipMessage(i: number) {
  const t = TIPS[i]!;
  return { content: `🪄 **Tip ${i + 1}: ${t.title}**\n\n${t.body}\n\n>> ${t.choice}`, parts: [{ type: "tip_image", src: t.image, title: t.title }] };
}
