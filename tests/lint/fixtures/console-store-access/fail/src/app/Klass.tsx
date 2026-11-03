import { Component } from 'react';
import { useToasts } from '#/shared/lib/repository/useToasts';

export class Banner extends Component {
  render() {
    useToasts.getState().push('a');
    return null;
  }
}
