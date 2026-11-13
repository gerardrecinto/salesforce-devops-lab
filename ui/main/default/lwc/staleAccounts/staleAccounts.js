import { LightningElement, wire } from 'lwc';
import getStaleAccounts from '@salesforce/apex/AccountHealthController.getStaleAccounts';

export default class StaleAccounts extends LightningElement {
    staleDays = 90;
    rows = [];
    error;

    @wire(getStaleAccounts, { staleDays: '$staleDays' })
    wiredAccounts({ data, error }) {
        if (data) {
            this.rows = data;
            this.error = undefined;
        } else if (error) {
            this.rows = [];
            this.error = error.body ? error.body.message : error.message;
        }
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    handleDaysChange(event) {
        const days = parseInt(event.target.value, 10);
        this.staleDays = days > 0 ? days : 90;
    }
}
