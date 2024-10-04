import * as vscode from 'vscode';

export class SettingsProvider implements vscode.TreeDataProvider<SettingItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SettingItem | undefined> = new vscode.EventEmitter<SettingItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<SettingItem | undefined> = this._onDidChangeTreeData.event;

    private apiKey: string | undefined;
    private gptModel: string | undefined;

    constructor() {
        const config = vscode.workspace.getConfiguration('code-docs-ai');
        this.apiKey = config.get<string>('apiKey');
        this.gptModel = config.get<string>('gptModel') || 'gpt-4';
    }

    getTreeItem(element: SettingItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SettingItem): Thenable<SettingItem[]> {
        const apiKeyItem = new SettingItem('API Key', this.apiKey || 'Enter your API key', vscode.TreeItemCollapsibleState.None);
        const modelItem = new SettingItem('GPT Model', this.gptModel || 'Select a model', vscode.TreeItemCollapsibleState.None);
        
        return Promise.resolve([apiKeyItem, modelItem]);
    }

    updateSettings(apiKey: string | undefined, model: string | undefined) {
        const config = vscode.workspace.getConfiguration('code-docs-ai');
        if (apiKey !== undefined) {
            this.apiKey = apiKey;
            config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        }
        if (model !== undefined) {
            this.gptModel = model;
            config.update('gptModel', model, vscode.ConfigurationTarget.Global);
        }
        this._onDidChangeTreeData.fire(undefined);
    }
}

export class SettingItem extends vscode.TreeItem {
    constructor(label: string, public value?: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
        this.tooltip = label;
        this.description = value;
        this.command = {
            command: 'extension.editSetting',
            title: 'Edit Setting',
            arguments: [this]
        };
    }
}
