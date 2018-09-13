/**
 * Extension entry point
 */

'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { languages } from 'vscode';

// Handles the '/** + enter' action before the code parsing begins
import { Snippets } from './snippets';

// Main parser class
import { Parser } from './parser';

// Get code parsers
import { JavaScript } from './languages/javascript';
import { PHP } from './languages/php';
import { TypeScript } from './languages/typescript';

export function activate() {
  // Associative list of allowed languages
  // Scheme as follows:
  //   language ID: class name
  const langList = {
    javascript: JavaScript,
    php: PHP,
    typescript: TypeScript,
  };
  // Register each language
  for (const language in langList) {
    if (langList.hasOwnProperty(language)) {
      // Get language parser object from list
      const parser: Parser = new langList[language]();
      // Create snippet object with the parser above
      const snippet = new Snippets(parser);
      // Register docblockr auto competition
      languages.registerCompletionItemProvider(language, snippet, '*', '@');
    }
  }
}
