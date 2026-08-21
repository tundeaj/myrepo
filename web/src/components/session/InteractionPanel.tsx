import { Panel, Toggle } from "./Panel";

export interface SessionConfig {
  chat_enabled: boolean;
  qa_enabled: boolean;
  polls_enabled: boolean;
  chat_moderated: boolean;
  allow_anonymous_qa: boolean;
}

interface Props {
  config: SessionConfig;
  onChange: (config: SessionConfig) => void;
}

export function InteractionPanel({ config, onChange }: Props) {
  function set(key: keyof SessionConfig, value: boolean) {
    onChange({ ...config, [key]: value });
  }

  return (
    <Panel title="Interaction" description="Controls available to participants during the live session.">
      <div className="space-y-4">
        <Toggle
          label="Chat enabled"
          description="Participants can send messages in the chat sidebar."
          checked={config.chat_enabled}
          onChange={(v) => set("chat_enabled", v)}
        />
        <Toggle
          label="Q&A enabled"
          description="Participants can submit questions for the host to address."
          checked={config.qa_enabled}
          onChange={(v) => set("qa_enabled", v)}
        />
        <Toggle
          label="Polls"
          description="Hosts can launch live polls during the session."
          checked={config.polls_enabled}
          onChange={(v) => set("polls_enabled", v)}
        />
        <div className="my-2 border-t border-slate-800" />
        <Toggle
          label="Moderate chat"
          description="Messages must be approved before appearing to others."
          checked={config.chat_moderated}
          onChange={(v) => set("chat_moderated", v)}
          disabled={!config.chat_enabled}
        />
        <Toggle
          label="Anonymous questions"
          description="Allow participants to submit Q&A questions without showing their name."
          checked={config.allow_anonymous_qa}
          onChange={(v) => set("allow_anonymous_qa", v)}
          disabled={!config.qa_enabled}
        />
      </div>
    </Panel>
  );
}
