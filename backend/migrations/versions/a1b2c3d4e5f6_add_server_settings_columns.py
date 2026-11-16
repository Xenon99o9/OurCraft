"""add_server_settings_columns

Revision ID: a1b2c3d4e5f6
Revises: 2bcbb66d9ac9
Create Date: 2026-11-15 13:34:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '2bcbb66d9ac9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('minecraft_servers', sa.Column('ram', sa.String(length=20), server_default='2G', nullable=False))
    op.add_column('minecraft_servers', sa.Column('server_type', sa.String(length=50), server_default='PAPER', nullable=False))
    op.add_column('minecraft_servers', sa.Column('version', sa.String(length=50), server_default='LATEST', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('minecraft_servers', 'version')
    op.drop_column('minecraft_servers', 'server_type')
    op.drop_column('minecraft_servers', 'ram')

