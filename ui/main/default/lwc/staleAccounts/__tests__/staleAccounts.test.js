import { createElement } from 'lwc';
import StaleAccounts from 'c/staleAccounts';
import getStaleAccounts from '@salesforce/apex/AccountHealthController.getStaleAccounts';

jest.mock(
    '@salesforce/apex/AccountHealthController.getStaleAccounts',
    () => {
        const {
            createApexTestWireAdapter
        } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const flushPromises = () => Promise.resolve();

function mount() {
    const el = createElement('c-stale-accounts', { is: StaleAccounts });
    document.body.appendChild(el);
    return el;
}

describe('c-stale-accounts', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    it('lists account names returned by Apex', async () => {
        const el = mount();
        getStaleAccounts.emit([
            { Id: '001A', Name: 'Acme' },
            { Id: '001B', Name: 'Globex' }
        ]);
        await flushPromises();
        const items = el.shadowRoot.querySelectorAll('[data-id="rows"] li');
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe('Acme');
    });

    it('shows the empty message when nothing is stale', async () => {
        const el = mount();
        getStaleAccounts.emit([]);
        await flushPromises();
        expect(el.shadowRoot.querySelector('[data-id="empty"]')).not.toBeNull();
    });

    it('shows the Apex error message', async () => {
        const el = mount();
        getStaleAccounts.error({ message: 'Insufficient access' });
        await flushPromises();
        expect(
            el.shadowRoot.querySelector('[data-id="error"]').textContent
        ).toBe('Insufficient access');
    });
});
