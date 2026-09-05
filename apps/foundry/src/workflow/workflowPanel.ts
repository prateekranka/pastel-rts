import {
  ContentApiError,
  fetchRevisions,
  publishDraft,
  revertPublication,
  validateDraft,
  type RevisionMetadata,
} from '../api/contentApi';
import { FoundrySession } from '../app/foundrySession';

export type WorkflowPanelOptions = {
  session: FoundrySession;
  saveDraft: () => Promise<string | null>;
  getLastSavedDraftRevision: () => string | null;
  previewDraft: () => void;
  setStatus: (message: string, kind?: 'ok' | 'error' | 'pending') => void;
};

export type WorkflowPanelHandle = {
  markDraftSaved: (draftRevision: string) => void;
  refreshRevisions: () => Promise<void>;
};

export function mountWorkflowPanel(root: HTMLElement, options: WorkflowPanelOptions): WorkflowPanelHandle {
  root.innerHTML = `
    <div class="workflow-steps" aria-label="Foundry content workflow">
      <span class="workflow-step active">1 Draft</span>
      <span class="workflow-arrow">→</span>
      <span class="workflow-step">2 Validate</span>
      <span class="workflow-arrow">→</span>
      <span class="workflow-step">3 Preview</span>
      <span class="workflow-arrow">→</span>
      <span class="workflow-step">4 Publish revision</span>
      <span class="workflow-arrow">→</span>
      <span class="workflow-step">5 Revert</span>
    </div>
    <div class="workflow-controls">
      <button type="button" id="workflow-save">Save draft</button>
      <button type="button" id="workflow-validate">Validate saved draft</button>
      <button type="button" id="workflow-preview">Preview draft</button>
      <button type="button" id="workflow-publish">Publish revision</button>
      <label class="revert-control">Retained revision
        <select id="workflow-revision"><option value="">Load revisions…</option></select>
      </label>
      <button type="button" id="workflow-revert">Revert selected</button>
    </div>
    <p class="workflow-note">Save and validate affect the draft only. Publish creates a new immutable revision. Revert creates another publication from retained source content.</p>
    <p class="status workflow-status" id="workflow-status" aria-live="polite"></p>
  `;

  let lastSavedDraftRevision: string | null = options.getLastSavedDraftRevision();
  let revisions: RevisionMetadata[] = [];

  root.querySelector('#workflow-save')?.addEventListener('click', () => {
    void save();
  });
  root.querySelector('#workflow-validate')?.addEventListener('click', () => {
    void validateSavedDraft();
  });
  root.querySelector('#workflow-preview')?.addEventListener('click', () => {
    options.previewDraft();
    setStatus('Preview uses the current local draft. It is not published.', 'pending');
  });
  root.querySelector('#workflow-publish')?.addEventListener('click', () => {
    void publish();
  });
  root.querySelector('#workflow-revert')?.addEventListener('click', () => {
    void revert();
  });

  const unsubscribe = options.session.subscribe(() => updateButtons());
  void refreshRevisions();

  return {
    markDraftSaved(draftRevision: string): void {
      lastSavedDraftRevision = draftRevision;
      updateButtons();
    },
    refreshRevisions,
  };

  async function save(): Promise<void> {
    try {
      const revision = await options.saveDraft();
      if (revision) {
        lastSavedDraftRevision = revision;
        updateButtons();
      }
    } catch {
      // The editor owns the detailed status and keeps its local values.
    }
  }

  async function validateSavedDraft(): Promise<void> {
    if (options.session.isDirty()) {
      setStatus('Save the current local edit before validation. Local values remain present.', 'error');
      return;
    }
    const expectedDraftRevision = lastSavedDraftRevision ?? options.getLastSavedDraftRevision();
    if (!expectedDraftRevision) {
      setStatus('Save the draft before validation. Local edits are still present.', 'error');
      return;
    }
    try {
      const result = await validateDraft(expectedDraftRevision);
      setStatus(`Draft ${result.draftRevision} validated. Published revision is unchanged.`, 'ok');
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function publish(): Promise<void> {
    const snapshot = options.session.getSnapshot();
    if (!snapshot.publication) {
      setStatus('Cannot publish while content connection is offline.', 'error');
      return;
    }
    if (snapshot.dirty) {
      setStatus('Save the local edit before publishing. The draft is not live.', 'error');
      return;
    }
    if (!lastSavedDraftRevision) {
      setStatus('Save the draft before publishing.', 'error');
      return;
    }
    try {
      const result = await publishDraft(snapshot.publication.currentRevision);
      options.session.setPublication(result.publication);
      options.session.setDirty(false);
      setStatus(`Published revision ${result.revision}. Runtime acknowledgement is pending.`, 'ok');
      await refreshRevisions();
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function revert(): Promise<void> {
    const select = root.querySelector('#workflow-revision');
    if (!(select instanceof HTMLSelectElement) || !select.value) {
      setStatus('Select a retained revision first.', 'error');
      return;
    }
    const snapshot = options.session.getSnapshot();
    if (!snapshot.publication) {
      setStatus('Cannot revert while content connection is offline.', 'error');
      return;
    }
    const target = revisions.find((revision) => revision.revision === select.value);
    const sourceLabel = target?.sourceRevision ? ` from source ${target.sourceRevision}` : '';
    if (!window.confirm(`Publish retained revision ${select.value}${sourceLabel}? Originals remain retained.`)) {
      return;
    }
    try {
      const result = await revertPublication(select.value, snapshot.publication.currentRevision);
      options.session.setPublication(result.publication);
      options.session.setDirty(false);
      lastSavedDraftRevision = result.publication.draftRevision;
      setStatus(`Reverted content into new publication ${result.revision}. Originals remain retained. Runtime acknowledgement is pending.`, 'ok');
      await refreshRevisions();
    } catch (error) {
      setStatus(formatApiError(error), 'error');
    }
  }

  async function refreshRevisions(): Promise<void> {
    try {
      const response = await fetchRevisions();
      revisions = response.revisions;
      const select = root.querySelector('#workflow-revision');
      if (!(select instanceof HTMLSelectElement)) {
        return;
      }
      const previous = select.value;
      select.innerHTML = '<option value="">Select retained revision…</option>';
      for (const revision of revisions) {
        const option = document.createElement('option');
        option.value = revision.revision;
        option.textContent = `Revision ${revision.revision} · ${revision.createdAt.slice(0, 19)}${revision.sourceRevision ? ` · reverted from ${revision.sourceRevision}` : ''}`;
        select.appendChild(option);
      }
      if (revisions.some((revision) => revision.revision === previous)) {
        select.value = previous;
      }
    } catch (error) {
      setStatus(`Retained revisions unavailable: ${formatApiError(error)}`, 'pending');
    }
  }

  function updateButtons(): void {
    const snapshot = options.session.getSnapshot();
    const validateButton = root.querySelector('#workflow-validate');
    const publishButton = root.querySelector('#workflow-publish');
    if (validateButton instanceof HTMLButtonElement) {
      validateButton.disabled = !lastSavedDraftRevision;
    }
    if (publishButton instanceof HTMLButtonElement) {
      publishButton.disabled = snapshot.connection !== 'connected' || snapshot.dirty || !lastSavedDraftRevision;
    }
  }

  function setStatus(message: string, kind: 'ok' | 'error' | 'pending' = 'ok'): void {
    options.setStatus(message, kind);
    const status = root.querySelector('#workflow-status');
    if (status instanceof HTMLElement) {
      status.textContent = message;
      status.className = `status workflow-status ${kind}`;
    }
  }

  void unsubscribe;
}

function formatApiError(error: unknown): string {
  if (!(error instanceof ContentApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 409 && error.code === 'revision-conflict') {
    const current = error.currentRevision ? ` Current draft/publication revision: ${error.currentRevision}.` : '';
    return `${error.message} Local edits were not discarded. Refresh and reconcile deliberately.${current}`;
  }
  if (error.status === 409 && error.code === 'dependency-conflict') {
    return `${error.message} Dependencies: ${error.dependencies.join(', ')}.`;
  }
  return error.message;
}
